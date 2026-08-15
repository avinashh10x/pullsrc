import { resolveHls, type HlsSegment } from "@/lib/pullsrc/server/hls";
import type { Asset } from "@/lib/pullsrc/types";

// The web app has to assemble streams inside a 60-second serverless function
// and proxy every byte. Here there is no function and no proxy: fetches run in
// the user's own session, so signed CDN URLs are still valid, cookies are
// attached, and a long video is just a long download.

export interface Progress {
  done: number;
  total: number;
  label: string;
}

function sanitize(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|\r\n]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 150) || "download"
  );
}

async function fetchSegment(segment: HlsSegment): Promise<Uint8Array> {
  const headers: Record<string, string> = {};
  if (segment.range) {
    const { offset, length } = segment.range;
    headers.range = `bytes=${offset}-${offset + length - 1}`;
  }
  const res = await fetch(segment.url, { headers, credentials: "include" });
  if (!res.ok) throw new Error(`segment responded ${res.status}`);

  const bytes = new Uint8Array(await res.arrayBuffer());
  // A byte range is a request the origin may ignore; slice when it does.
  if (segment.range && res.status !== 206) {
    const { offset, length } = segment.range;
    return bytes.slice(offset, offset + length);
  }
  return bytes;
}

/** Assembles an HLS playlist into one file. Resolves to a blob: URL. */
export async function assembleStream(
  playlistUrl: string,
  onProgress?: (progress: Progress) => void,
): Promise<{ url: string; extension: string }> {
  const media = await resolveHls(playlistUrl);
  if (!media || media.segments.length === 0) {
    throw new Error("Couldn't read that stream's playlist");
  }

  const extension = media.container === "fmp4" ? "mp4" : "ts";
  const type = media.container === "fmp4" ? "video/mp4" : "video/mp2t";

  // When every segment is a byte range into one file, that file is already a
  // complete fMP4 — fetch it whole rather than reassembling it piece by piece.
  if (media.wholeFileUrl) {
    onProgress?.({ done: 0, total: 1, label: "Downloading" });
    const res = await fetch(media.wholeFileUrl, { credentials: "include" });
    if (res.ok) {
      const blob = await res.blob();
      onProgress?.({ done: 1, total: 1, label: "Done" });
      return { url: URL.createObjectURL(blob), extension };
    }
    // Fall through to segment assembly if the whole-file fetch failed.
  }

  const queue = media.init ? [media.init, ...media.segments] : media.segments;
  const parts: BlobPart[] = [];
  for (const [index, segment] of queue.entries()) {
    parts.push(await fetchSegment(segment) as BlobPart);
    onProgress?.({ done: index + 1, total: queue.length, label: "Assembling" });
  }

  return {
    url: URL.createObjectURL(new Blob(parts, { type })),
    extension,
  };
}

function baseName(asset: Asset & { url: string }): string {
  return sanitize(asset.name).replace(/\.m3u8$/i, "");
}

/**
 * Saves one asset. Streams are assembled first; everything else is handed
 * straight to the browser's download manager, which reuses the page session
 * and so keeps signed URLs valid.
 */
export async function downloadAsset(
  asset: Asset,
  onProgress?: (progress: Progress) => void,
): Promise<void> {
  if (asset.category === "colors" || !("url" in asset)) return;

  const folder = asset.category;
  const streaming =
    (asset.category === "video" || asset.category === "audio") &&
    asset.wasStreaming;

  if (streaming) {
    const { url, extension } = await assembleStream(asset.url, onProgress);
    await chrome.downloads.download({
      url,
      filename: `PullSRC/${folder}/${baseName(asset)}.${extension}`,
    });
    // The blob has to outlive the handoff to the download manager.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }

  await chrome.downloads.download({
    url: asset.url,
    filename: `PullSRC/${folder}/${sanitize(asset.name)}`,
  });

  // A split stream's sound is a second real file; without it the video is silent.
  if (asset.category === "video" && asset.audioUrl && asset.audioName) {
    await chrome.downloads.download({
      url: asset.audioUrl,
      filename: `PullSRC/${folder}/${sanitize(asset.audioName)}`,
    });
  }
}
