import JSZip from "jszip"

import { buildCreditSheet } from "./credit"
import type { Asset, ScanResult } from "./types"

function downloadProxyUrl(url: string, name: string, referer: string) {
  return `/api/download?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}&referer=${encodeURIComponent(referer)}`
}

function hasDownloadableUrl(
  asset: Asset
): asset is Asset & { url: string } {
  if (asset.category === "colors") return false
  if ((asset.category === "video" || asset.category === "audio") && asset.wasStreaming) return false
  return "url" in asset
}

export async function buildExportZip(
  result: ScanResult,
  assets: Asset[]
): Promise<Blob> {
  const zip = new JSZip()
  const downloadable = assets.filter(hasDownloadableUrl)

  await Promise.all(
    downloadable.map(async (asset) => {
      try {
        const res = await fetch(downloadProxyUrl(asset.url, asset.name, result.pageUrl))
        if (!res.ok) return
        const blob = await res.blob()
        zip.folder(asset.category)?.file(asset.name, blob)
      } catch {
        // skip assets that fail to fetch, keep the rest of the export intact
      }
    })
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
