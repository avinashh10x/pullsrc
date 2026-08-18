import { buildFontAssets } from "@/lib/pullsrc/font-assets";
import { formatBytes, headSafely, mapWithConcurrency } from "@/lib/pullsrc/server/http";
import {
  reconcileTracks,
  type TrackCandidate,
} from "@/lib/pullsrc/media-reconcile";
import { classifyMediaUrl, IMAGE_EXT } from "@/lib/pullsrc/media-classify";
import type {
  Asset,
  AudioAsset,
  ColorAsset,
  CreditInfo,
  ImageAsset,
  LogoAsset,
  Model3DAsset,
  ScanResult,
  VideoAsset,
} from "@/lib/pullsrc/types";

import type { CapturedMedia, PageSnapshot } from "./shared";

// Wire capture + DOM snapshot → the same ScanResult the web app produces, so
// the credit sheet and zip export work unchanged.

const MAX_IMAGES = 60;
const MAX_FONTS = 20;

function nameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : url;
  } catch {
    return url;
  }
}

function fileTypeFromUrl(url: string, fallback: string): string {
  try {
    const match = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname);
    return match ? match[1].toUpperCase() : fallback;
  } catch {
    return fallback;
  }
}

function ensureFileExtension(name: string, fileType: string): string {
  const ext = fileType.toLowerCase();
  if (!/^[a-z0-9]{1,5}$/.test(ext)) return name;
  const match = /\.([a-z0-9]{1,5})$/i.exec(name);
  if (match && match[1].toLowerCase() === ext) return name;
  return `${match ? name.slice(0, match.index) : name}.${ext}`;
}

/**
 * The worker only sees requests made while awake, so a page loaded before the
 * panel opened contributes nothing. Folding in the resource timeline is what
 * makes short one-shot sounds (clicks, whooshes, hover SFX) show up.
 */
function mergeDomMedia(
  snapshot: PageSnapshot,
  captured: CapturedMedia[],
): CapturedMedia[] {
  const merged = [...captured];
  const seen = new Set(captured.map((item) => item.url));

  for (const resource of snapshot.resources) {
    if (seen.has(resource.url)) continue;
    const classified = classifyMediaUrl(resource.url, "");
    if (!classified) continue;
    seen.add(resource.url);
    merged.push({
      url: resource.url,
      kind: classified.kind,
      isStreaming: classified.isStreaming,
      contentType: "",
      sizeBytes: null, // filled by the HEAD in sizeOf below
    });
  }
  return merged;
}

export async function assembleAssets(
  snapshot: PageSnapshot,
  capturedOnWire: CapturedMedia[],
): Promise<ScanResult> {
  const captured = mergeDomMedia(snapshot, capturedOnWire);

  const scanDate = new Date().toISOString().slice(0, 10);
  let sourceDomain = "";
  try {
    sourceDomain = new URL(snapshot.pageUrl).hostname;
  } catch {
    sourceDomain = snapshot.pageUrl;
  }

  const credit: CreditInfo = {
    sourceDomain,
    pageTitle: snapshot.pageTitle,
    originalUrl: snapshot.pageUrl,
    scanDate,
  };

  const assets: Asset[] = [];

  // --- images + logo ------------------------------------------------------
  const imageResources = snapshot.resources.filter((resource) =>
    IMAGE_EXT.test(safePath(resource.url)),
  );
  const logoResource =
    imageResources.find((resource) => resource.looksLikeLogo) ?? null;
  const plainImages = imageResources
    .filter((resource) => resource !== logoResource)
    .slice(0, MAX_IMAGES);

  const [imageSizes, logoSize] = await Promise.all([
    mapWithConcurrency(plainImages, 8, (resource) => headSafely(resource.url)),
    logoResource ? headSafely(logoResource.url) : Promise.resolve(null),
  ]);

  if (logoResource) {
    const fileType = fileTypeFromUrl(logoResource.url, "IMG");
    assets.push({
      id: "logo-0",
      category: "logo",
      name: ensureFileExtension(nameFromUrl(logoResource.url), fileType),
      url: logoResource.url,
      fileType,
      size: formatBytes(logoSize?.contentLength ?? null),
      sizeBytes: logoSize?.contentLength ?? null,
      confidence: "likely",
      credit,
    } satisfies LogoAsset);
  }

  plainImages.forEach((resource, index) => {
    const fileType = fileTypeFromUrl(resource.url, "IMG");
    assets.push({
      id: `image-${index}`,
      category: "images",
      name: ensureFileExtension(nameFromUrl(resource.url), fileType),
      url: resource.url,
      fileType,
      size: formatBytes(imageSizes[index]?.contentLength ?? null),
      sizeBytes: imageSizes[index]?.contentLength ?? null,
      credit,
    } satisfies ImageAsset);
  });

  // --- fonts --------------------------------------------------------------
  // Shared with the web app so a font scanned either way offers the same
  // downloads: an installable TTF/OTF headline plus every format found.
  assets.push(...(await buildFontAssets(snapshot.fonts, credit, MAX_FONTS)));

  // --- colours ------------------------------------------------------------
  snapshot.colors.forEach((hex, index) => {
    assets.push({
      id: `color-${index}`,
      category: "colors",
      name: hex.toUpperCase(),
      hex,
      fileType: "HEX",
      size: "—",
      credit,
    } satisfies ColorAsset);
  });

  // --- video / audio / 3d -------------------------------------------------
  // Same reconciliation the web app runs.
  const asCandidate = (item: CapturedMedia): TrackCandidate => ({
    url: item.url,
    isStreaming: item.isStreaming,
  });
  const reconciled = await reconcileTracks(
    captured.filter((item) => item.kind === "video").map(asCandidate),
    captured.filter((item) => item.kind === "audio").map(asCandidate),
  );

  const sizeByUrl = new Map(captured.map((item) => [item.url, item.sizeBytes]));
  async function sizeOf(url: string): Promise<number | null> {
    const known = sizeByUrl.get(url);
    if (known) return known;
    return (await headSafely(url))?.contentLength ?? null;
  }

  let videoIndex = 0;
  for (const video of reconciled.videos) {
    const bytes = video.isStreaming ? null : await sizeOf(video.url);
    const audioBytes = video.audioUrl ? await sizeOf(video.audioUrl) : null;
    const fileType = video.isStreaming ? "HLS" : fileTypeFromUrl(video.url, "MP4");
    assets.push({
      id: `video-${videoIndex++}`,
      category: "video",
      name: video.isStreaming
        ? nameFromUrl(video.url)
        : ensureFileExtension(nameFromUrl(video.url), fileType),
      url: video.url,
      wasStreaming: video.isStreaming,
      fileType,
      size: video.isStreaming ? "—" : formatBytes(bytes),
      sizeBytes: bytes,
      ...(video.audioUrl
        ? {
            audioUrl: video.audioUrl,
            audioName: ensureFileExtension(nameFromUrl(video.audioUrl), "M4A"),
            audioSizeBytes: audioBytes,
          }
        : {}),
      credit,
    } satisfies VideoAsset);
  }

  let audioIndex = 0;
  for (const audio of reconciled.audio) {
    const bytes = audio.isStreaming ? null : await sizeOf(audio.url);
    const fileType = audio.isStreaming ? "HLS" : fileTypeFromUrl(audio.url, "MP3");
    assets.push({
      id: `audio-${audioIndex++}`,
      category: "audio",
      name: audio.isStreaming
        ? nameFromUrl(audio.url)
        : ensureFileExtension(nameFromUrl(audio.url), fileType),
      url: audio.url,
      wasStreaming: audio.isStreaming,
      fileType,
      size: audio.isStreaming ? "—" : formatBytes(bytes),
      sizeBytes: bytes,
      credit,
    } satisfies AudioAsset);
  }

  const models = captured.filter((item) => item.kind === "model3d");
  models.forEach((model, index) => {
    const fileType = fileTypeFromUrl(model.url, "GLB");
    assets.push({
      id: `model3d-${index}`,
      category: "model3d",
      name: ensureFileExtension(nameFromUrl(model.url), fileType),
      url: model.url,
      fileType,
      size: formatBytes(model.sizeBytes),
      sizeBytes: model.sizeBytes,
      credit,
    } satisfies Model3DAsset);
  });

  return {
    pageUrl: snapshot.pageUrl,
    pageTitle: snapshot.pageTitle,
    sourceDomain,
    scanDate,
    assets,
  };
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
