import type { Asset, MediaVariant } from "./types"

// /api/download streams an existing file; /api/stream assembles an HLS
// playlist into one. Card buttons and the ZIP export must agree, so the choice
// lives here.

interface Downloadable {
  url: string
  name: string
  wasStreaming?: boolean
  drmProtected?: boolean
  sizeBytes?: number | null
}

export function downloadHref(item: Downloadable, referer: string): string {
  const params = new URLSearchParams({ url: item.url, name: item.name, referer })
  if (item.wasStreaming) return `/api/stream?${params}`
  // Lets the proxy spot an expired link that now returns only a header.
  if (item.sizeBytes) params.set("bytes", String(item.sizeBytes))
  return `/api/download?${params}`
}

/** DRM is the only thing that is genuinely unobtainable; streams are assembled. */
export function isDownloadable(item: {
  wasStreaming?: boolean
  drmProtected?: boolean
}): boolean {
  return !item.drmProtected
}

export function variantHref(variant: MediaVariant, referer: string): string {
  return downloadHref(variant, referer)
}

/** An HLS asset has no single file to name, so give it the container it becomes. */
export function downloadFilename(item: Downloadable): string {
  if (!item.wasStreaming) return item.name
  return item.name.replace(/\.m3u8(?:\?.*)?$/i, "") + ".mp4"
}

export function assetDownloads(
  asset: Asset,
  referer: string,
): Array<{ href: string; filename: string; label: string }> {
  if (!("url" in asset)) return []
  if (asset.category === "video" || asset.category === "audio") {
    if (!isDownloadable(asset)) return []
  }

  const primary = {
    href: downloadHref(asset as Downloadable, referer),
    filename: downloadFilename(asset as Downloadable),
    label: "file",
  }

  // Without the sound track the picture is silent, with no hint why.
  if (asset.category === "video" && asset.audioUrl && asset.audioName) {
    return [
      { ...primary, label: "video" },
      {
        href: downloadHref(
          {
            url: asset.audioUrl,
            name: asset.audioName,
            sizeBytes: asset.audioSizeBytes,
          },
          referer,
        ),
        filename: asset.audioName,
        label: "audio",
      },
    ]
  }

  return [primary]
}
