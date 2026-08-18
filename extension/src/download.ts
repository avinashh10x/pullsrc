import { sniffFormat, toInstallableFont } from "@/lib/pullsrc/font-convert";
import { resolveHls, type HlsSegment } from "@/lib/pullsrc/server/hls";
import type { Asset, MediaVariant } from "@/lib/pullsrc/types";

import { decodeWoff2 } from "./font-woff2";

// No serverless function and no proxy here: fetches run in the user's session,
// so signed URLs stay valid and a long video is just a long download.

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
  // Some origins ignore Range and send the whole file; slice when they do.
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

  // One file addressed by ranges is already a complete fMP4; fetch it whole.
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

function withExtension(name: string, extension: string): string {
  const match = /\.([a-z0-9]{1,5})$/i.exec(name);
  if (match && match[1].toLowerCase() === extension) return name;
  return `${match ? name.slice(0, match.index) : name}.${extension}`;
}

/**
 * Web fonts arrive wrapped in WOFF/WOFF2, which most systems won't install.
 * The fetch always runs here, in the user's own session, so a font behind a
 * login still works — see font-woff2 for the one step that can't stay local.
 */
export async function convertFont(
  url: string,
  name: string,
): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`The font responded ${res.status}`);

  const bytes = new Uint8Array(await res.arrayBuffer());
  // Only the magic bytes decide: an expired link answers 200 with a login page
  // that would otherwise be saved under a .ttf name and look fine.
  const format = sniffFormat(bytes);
  if (!format) {
    throw new Error("That link returned something that isn't a font");
  }
  const converted = await toInstallableFont(bytes, format, decodeWoff2);

  return {
    blob: new Blob([converted.bytes as BlobPart], {
      type: `font/${converted.extension}`,
    }),
    filename: withExtension(sanitize(name), converted.extension),
  };
}

/** The bytes an asset's headline download should produce, ready to save. */
export async function assetBlob(
  asset: Asset & { url: string },
): Promise<{ blob: Blob; filename: string } | null> {
  if (asset.category === "fonts" && asset.convertFrom) {
    return convertFont(asset.url, asset.name);
  }
  const res = await fetch(asset.url, { credentials: "include" });
  if (!res.ok) return null;
  return { blob: await res.blob(), filename: sanitize(asset.name) };
}

/** Saves one specific rendition — what the format/quality menu picks. */
export async function downloadVariant(
  asset: Asset,
  variant: MediaVariant,
  onProgress?: (progress: Progress) => void,
): Promise<void> {
  const folder = asset.category;

  if (variant.convertFont) {
    const { blob, filename } = await convertFont(variant.url, variant.name);
    const objectUrl = URL.createObjectURL(blob);
    await chrome.downloads.download({
      url: objectUrl,
      filename: `PullSRC/${folder}/${filename}`,
    });
    // Must outlive the handoff to the download manager.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return;
  }

  if (variant.wasStreaming) {
    const { url, extension } = await assembleStream(variant.url, onProgress);
    await chrome.downloads.download({
      url,
      filename: `PullSRC/${folder}/${sanitize(variant.name).replace(/\.m3u8$/i, "")}.${extension}`,
    });
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }

  await chrome.downloads.download({
    url: variant.url,
    filename: `PullSRC/${folder}/${sanitize(variant.name)}`,
  });
}

/** Streams get assembled first; the rest go straight to the download manager. */
export async function downloadAsset(
  asset: Asset,
  onProgress?: (progress: Progress) => void,
): Promise<void> {
  if (asset.category === "colors" || !("url" in asset)) return;

  const folder = asset.category;
  const streaming =
    (asset.category === "video" || asset.category === "audio") &&
    asset.wasStreaming;

  // The card advertises an installable font, so hand over one — the file the
  // page served is a wrapper the user mostly can't open.
  if (asset.category === "fonts" && asset.convertFrom) {
    const { blob, filename } = await convertFont(asset.url, asset.name);
    const objectUrl = URL.createObjectURL(blob);
    await chrome.downloads.download({
      url: objectUrl,
      filename: `PullSRC/${folder}/${filename}`,
    });
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return;
  }

  if (streaming) {
    const { url, extension } = await assembleStream(asset.url, onProgress);
    await chrome.downloads.download({
      url,
      filename: `PullSRC/${folder}/${baseName(asset)}.${extension}`,
    });
    // Must outlive the handoff to the download manager.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }

  await chrome.downloads.download({
    url: asset.url,
    filename: `PullSRC/${folder}/${sanitize(asset.name)}`,
  });

  // Without its partner track the video is silent.
  if (asset.category === "video" && asset.audioUrl && asset.audioName) {
    await chrome.downloads.download({
      url: asset.audioUrl,
      filename: `PullSRC/${folder}/${sanitize(asset.audioName)}`,
    });
  }
}
