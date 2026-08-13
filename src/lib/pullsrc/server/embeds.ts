import * as cheerio from "cheerio"

import { fetchTextSafely, mapWithConcurrency, resolveUrl } from "./http"
import type { RawVideo } from "./extract"

// Iframe-embedded players host their media on the provider's origin, so the
// page HTML contains no <video> tag and no file URL at all — only the embed
// URL. Each provider needs its own resolver to turn that into real files.

const VIDEOPRESS_GUID = /(?:videopress\.com|video\.wordpress\.com)\/(?:embed|v)\/([A-Za-z0-9]{8})/gi
const VIDEOPRESS_API = "https://public-api.wordpress.com/rest/v1.1/videos/"
const MAX_EMBEDS = 12

export function extractIframeUrls($: cheerio.CheerioAPI, pageUrl: string): string[] {
  const seen = new Set<string>()
  $("iframe").each((_, el) => {
    const $el = $(el)
    const raw = $el.attr("src") ?? $el.attr("data-src") ?? $el.attr("data-lazy-src")
    if (!raw) return
    const absolute = resolveUrl(raw, pageUrl)
    if (absolute) seen.add(absolute)
  })
  return [...seen]
}

interface VideoPressInfo {
  original?: string
  adaptive_streaming?: string | null
  file_url_base?: { https?: string }
  files?: Record<string, { mp4?: string } | null>
}

async function resolveVideoPress(guid: string): Promise<RawVideo | null> {
  const text = await fetchTextSafely(`${VIDEOPRESS_API}${guid}`, {
    timeoutMs: 6000,
    maxBytes: 200_000,
  })
  if (!text) return null

  let info: VideoPressInfo
  try {
    info = JSON.parse(text)
  } catch {
    return null
  }

  const variants: RawVideo[] = []
  const seen = new Set<string>()
  function push(url: string | null | undefined, isStreaming: boolean) {
    if (!url || seen.has(url)) return
    seen.add(url)
    variants.push({ url, isStreaming })
  }

  // `original` first — it is the untranscoded upload, the best thing to hand
  // someone who wants the asset rather than a stream.
  push(info.original, false)

  const base = info.file_url_base?.https
  if (base) {
    for (const file of Object.values(info.files ?? {})) {
      if (file?.mp4) push(resolveUrl(file.mp4, base), false)
    }
  }
  push(info.adaptive_streaming, true)

  if (variants.length === 0) return null
  const recommended = variants.find((variant) => !variant.isStreaming) ?? variants[0]
  return { ...recommended, variants }
}

// Resolves every recognised player embed on the page into downloadable files.
// `html` is scanned alongside the parsed iframes because plenty of sites ship
// the embed URL inside a script payload and mount the iframe client-side.
export async function resolveEmbedVideos(
  iframeUrls: string[],
  html: string
): Promise<RawVideo[]> {
  const guids = new Set<string>()
  for (const source of [...iframeUrls, html.replaceAll("\\/", "/")]) {
    for (const match of source.matchAll(VIDEOPRESS_GUID)) guids.add(match[1])
  }
  if (guids.size === 0) return []

  const resolved = await mapWithConcurrency(
    [...guids].slice(0, MAX_EMBEDS),
    4,
    resolveVideoPress
  )
  return resolved.filter((video): video is RawVideo => video !== null)
}
