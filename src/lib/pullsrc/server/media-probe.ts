import { fetchWithTimeout } from "./http";

// fbcdn serves picture, sound and bare DASH fragments from identical-looking
// `AQ…mp4` URLs, so only the bytes can say which is which.

export type TrackKind = "video" | "audio";

const PROBE_BYTES = 4096;

// Range is a request, not a promise — some CDNs answer 200 with the whole
// file, so reading from the stream and cancelling is what bounds the transfer.
async function fetchHead(url: string, limit: number): Promise<Uint8Array | null> {
  let res: Response;
  try {
    res = await fetchWithTimeout(url, {
      timeoutMs: 6000,
      headers: { range: `bytes=0-${limit - 1}` },
    });
  } catch {
    return null;
  }
  if (!res.ok || !res.body) return null;

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => {});
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

const HDLR = [0x68, 0x64, 0x6c, 0x72];

function readFourCC(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

// size(4) "hdlr"(4) version+flags(4) pre_defined(4) handler(4). Scanning for
// the marker instead of walking the tree tolerates muxer-specific nesting.
function handlersIn(bytes: Uint8Array): string[] {
  const found: string[] = [];
  for (let i = 0; i + 20 <= bytes.length; i++) {
    if (
      bytes[i] !== HDLR[0] ||
      bytes[i + 1] !== HDLR[1] ||
      bytes[i + 2] !== HDLR[2] ||
      bytes[i + 3] !== HDLR[3]
    )
      continue;
    found.push(readFourCC(bytes, i + 12));
  }
  return found;
}

export interface Mp4Tracks {
  hasVideo: boolean;
  hasAudio: boolean;
  kind: TrackKind;
  /** Picture but no sound — half of a split stream, needs its partner. */
  silent: boolean;
}

/** Null when `moov` isn't in the opening bytes, or there's no `moov` at all. */
export async function probeMp4Track(url: string): Promise<Mp4Tracks | null> {
  const head = await fetchHead(url, PROBE_BYTES);
  if (!head) return null;

  const handlers = handlersIn(head);
  const hasVideo = handlers.includes("vide");
  const hasAudio = handlers.includes("soun");
  if (!hasVideo && !hasAudio) return null;

  return {
    hasVideo,
    hasAudio,
    kind: hasVideo ? "video" : "audio",
    silent: hasVideo && !hasAudio,
  };
}

/** A DASH fragment rather than a file — unplayable on its own. */
export async function isBareSegment(url: string): Promise<boolean> {
  const head = await fetchHead(url, 64);
  if (!head || head.length < 8) return false;
  const first = readFourCC(head, 4);
  return first === "sidx" || first === "moof" || first === "styp";
}
