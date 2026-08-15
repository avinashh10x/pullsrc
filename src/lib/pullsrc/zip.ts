import JSZip from "jszip"

import { buildCreditSheet } from "./credit"
import { assetDownloads } from "./download"
import type { Asset, ScanResult } from "./types"

function hasDownloadableUrl(
  asset: Asset
): asset is Asset & { url: string } {
  if (asset.category === "colors") return false
  // Streams are no longer excluded — /api/stream assembles them into a file.
  // DRM still is, since there is nothing to assemble.
  if ((asset.category === "video" || asset.category === "audio") && asset.drmProtected) return false
  return "url" in asset
}

// The proxy corrects the extension from the upstream Content-Type, which
// matters for fonts and optimizer URLs whose path carries no extension at
// all. Honour its filename instead of the one derived from the url.
function filenameFromResponse(response: Response, fallback: string): string {
  const disposition = response.headers.get("content-disposition") ?? ""
  const match = /filename="([^"]+)"/.exec(disposition)
  return match?.[1] || fallback
}

export async function buildExportZip(
  result: ScanResult,
  assets: Asset[]
): Promise<Blob> {
  const zip = new JSZip()
  const downloadable = assets.filter(hasDownloadableUrl)

  await Promise.all(
    downloadable.flatMap((asset) =>
      // A split stream contributes two files, so one asset can be several
      // entries in the zip.
      assetDownloads(asset, result.pageUrl).map(async (download) => {
        try {
          const res = await fetch(download.href)
          if (!res.ok) return
          const blob = await res.blob()
          zip
            .folder(asset.category)
            ?.file(filenameFromResponse(res, download.filename), blob)
        } catch {
          // skip assets that fail to fetch, keep the rest of the export intact
        }
      })
    )
  )

  zip.file("credit-sheet.txt", buildCreditSheet({ ...result, assets }))

  return zip.generateAsync({ type: "blob" })
}

export function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
