import { fetchWithTimeout } from "./http";

// Some CDNs name their media honestly (`CMAF_AUDIO_128.mp4`) and the URL-based
// classifier gets it right. Others — fbcdn especially — serve every track from
// an opaque `AQxyz…mp4` blob, so an audio-only track and a silent video track
// are indistinguishable by name. The only reliable answer is in the bytes: an
// MP4's `hdlr` box states its handler type outright.

export type TrackKind = "video" | "audio";

// Enough to reach `moov`/`hdlr` in a faststart file without pulling the media.
const PROBE_BYTES = 4096;

// Range is a request, not a promise — fbcdn answers 200 with the whole file.
// Reading from the stream and cancelling bounds the transfer either way.
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

const HDLR = [0x68, 0x64, 0x6c, 0x72]; // "hdlr"

function readFourCC(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

// Box layout: size(4) "hdlr"(4) version+flags(4) pre_defined(4) handler(4).
// Scanning for the marker rather than walking the tree keeps this tolerant of
// the box nesting differing between muxers.
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
  /** What to call it: a file with any picture track is a video. */
  kind: TrackKind;
  /** Picture but no sound — the half of a split stream that needs its partner. */
  silent: boolean;
}

/**
 * Reads an MP4's `hdlr` boxes to report which tracks it actually carries.
 * Returns null when the answer isn't in the opening bytes — a non-faststart
 * file with `moov` at the end, or a bare DASH segment with no `moov` at all.
 */
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

/**
 * True when the bytes are a DASH/CMAF media segment rather than a standalone
 * file — no `ftyp`, and typically opening on `sidx` or `moof`. Handing one of
 * these to someone as a download produces a file nothing will play.
 */
export async function isBareSegment(url: string): Promise<boolean> {
  const head = await fetchHead(url, 64);
  if (!head || head.length < 8) return false;
  const first = readFourCC(head, 4);
  return first === "sidx" || first === "moof" || first === "styp";
}
