import { fetchTextSafely, resolveUrl } from "./http";

// A master playlist lists renditions; a media playlist lists segments. Parsing
// both is the only way to turn an m3u8 into a file someone can keep.

export interface HlsByteRange {
  offset: number;
  length: number;
}

export interface HlsSegment {
  url: string;
  range?: HlsByteRange;
}

export interface HlsMedia {
  init: HlsSegment | null;
  segments: HlsSegment[];
  // fMP4 concatenates into a valid MP4; MPEG-TS into a .ts (VLC, not MP4).
  container: "fmp4" | "ts";
  // Every segment is a range into one file, which is already a complete fMP4.
  wholeFileUrl: string | null;
}

export interface HlsVariant {
  url: string;
  bandwidth: number;
  resolution: string | null;
}

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function isMasterPlaylist(text: string): boolean {
  return text.includes("#EXT-X-STREAM-INF");
}

export function parseMasterPlaylist(text: string, base: string): HlsVariant[] {
  const out: HlsVariant[] = [];
  const all = lines(text);
  for (let i = 0; i < all.length; i++) {
    if (!all[i].startsWith("#EXT-X-STREAM-INF")) continue;
    const uri = all[i + 1];
    if (!uri || uri.startsWith("#")) continue;
    const url = resolveUrl(uri, base);
    if (!url) continue;
    out.push({
      url,
      bandwidth: Number(/BANDWIDTH=(\d+)/.exec(all[i])?.[1] ?? 0),
      resolution: /RESOLUTION=([\dx]+)/.exec(all[i])?.[1] ?? null,
    });
  }
  return out.sort((a, b) => b.bandwidth - a.bandwidth);
}

// "<length>[@<offset>]" — a missing offset means "after the previous range".
function parseRange(
  spec: string | undefined,
  cursorFor: (url: string) => number,
  url: string,
): HlsByteRange | undefined {
  if (!spec) return undefined;
  const match = /^(\d+)(?:@(\d+))?$/.exec(spec.trim());
  if (!match) return undefined;
  const length = Number(match[1]);
  const offset = match[2] !== undefined ? Number(match[2]) : cursorFor(url);
  return { offset, length };
}

export function parseMediaPlaylist(text: string, base: string): HlsMedia {
  const all = lines(text);
  const segments: HlsSegment[] = [];
  const cursors = new Map<string, number>();
  const cursorFor = (url: string) => cursors.get(url) ?? 0;

  let init: HlsSegment | null = null;
  let pendingRange: string | undefined;

  for (const line of all) {
    if (line.startsWith("#EXT-X-MAP:")) {
      const uri = /URI="([^"]+)"/.exec(line)?.[1];
      const url = uri ? resolveUrl(uri, base) : null;
      if (url) {
        const range = parseRange(
          /BYTERANGE="([^"]+)"/.exec(line)?.[1],
          cursorFor,
          url,
        );
        init = { url, range };
        if (range) cursors.set(url, range.offset + range.length);
      }
      continue;
    }
    if (line.startsWith("#EXT-X-BYTERANGE:")) {
      pendingRange = line.slice("#EXT-X-BYTERANGE:".length);
      continue;
    }
    if (line.startsWith("#")) continue;

    const url = resolveUrl(line, base);
    if (!url) {
      pendingRange = undefined;
      continue;
    }
    const range = parseRange(pendingRange, cursorFor, url);
    if (range) cursors.set(url, range.offset + range.length);
    segments.push({ url, range });
    pendingRange = undefined;
  }

  const container = segments.some((segment) => /\.ts(?:\?|#|$)/i.test(segment.url))
    ? "ts"
    : "fmp4";

  // Reddit and other CMAF packagers publish one file addressed purely by byte
  // range; spotting that turns dozens of requests into one clean download.
  const urls = new Set(segments.map((segment) => segment.url));
  if (init) urls.add(init.url);
  const everySegmentRanged =
    segments.length > 0 && segments.every((segment) => segment.range);
  const wholeFileUrl =
    urls.size === 1 && everySegmentRanged ? [...urls][0] : null;

  return { init, segments, container, wholeFileUrl };
}

/** Resolves an m3u8 to its best rendition's segments, following one master. */
export async function resolveHls(url: string): Promise<HlsMedia | null> {
  const text = await fetchTextSafely(url, { timeoutMs: 8000, maxBytes: 2_000_000 });
  if (!text || !text.includes("#EXTM3U")) return null;

  if (!isMasterPlaylist(text)) return parseMediaPlaylist(text, url);

  const best = parseMasterPlaylist(text, url)[0];
  if (!best) return null;
  const mediaText = await fetchTextSafely(best.url, {
    timeoutMs: 8000,
    maxBytes: 2_000_000,
  });
  if (!mediaText) return null;
  return parseMediaPlaylist(mediaText, best.url);
}
