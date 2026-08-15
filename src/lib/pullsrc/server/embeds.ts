import * as cheerio from "cheerio"

import { fetchTextSafely, mapWithConcurrency, resolveUrl } from "./http"
import type { RawVideo } from "./extract"

// Iframe-embedded players host their media on the provider's origin, so the
// page HTML contains no <video> tag and no file URL at all — only the embed
// URL. Each provider needs its own resolver to turn that into real files.

const VIDEOPRESS_GUID = /(?:videopress\.com|video\.wordpress\.com)\/(?:embed|v)\/([A-Za-z0-9]{8})/gi
const VIDEOPRESS_API = "https://public-api.wordpress.com/rest/v1.1/videos/"
const MAX_EMBEDS = 12

const VIMEO_ID = /(?:player\.)?vimeo\.com\/(?:video\/)?(\d{6,})/gi
const YOUTUBE_ID =
  /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^"'\s]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/gi

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
  // Keyed by the same rendition names as `files` — carries the human label
  // ("480p", "1080p") that the filenames themselves never spell out.
  format_meta?: Record<string, { label?: string } | null>
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
  function push(
    url: string | null | undefined,
    isStreaming: boolean,
    quality?: string
  ) {
    if (!url || seen.has(url)) return
    seen.add(url)
    variants.push({ url, isStreaming, quality })
  }

  // `original` first — it is the untranscoded upload, the best thing to hand
  // someone who wants the asset rather than a stream.
  push(info.original, false, "Original")

  const base = info.file_url_base?.https
  if (base) {
    for (const [rendition, file] of Object.entries(info.files ?? {})) {
      if (file?.mp4) {
        push(resolveUrl(file.mp4, base), false, info.format_meta?.[rendition]?.label)
      }
    }
  }
  push(info.adaptive_streaming, true)

  if (variants.length === 0) return null
  const recommended = variants.find((variant) => !variant.isStreaming) ?? variants[0]
  return { ...recommended, variants }
}

interface VimeoConfig {
  request?: {
    files?: {
      progressive?: Array<{ url?: string; quality?: string }>
      hls?: { cdns?: Record<string, { url?: string } | null> }
    }
  }
}

// Vimeo publishes its player configuration openly. Most videos no longer offer
// progressive MP4s there, so HLS is usually all there is — which is fine, since
// /api/stream turns a playlist into a real file.
async function resolveVimeo(id: string): Promise<RawVideo | null> {
  const text = await fetchTextSafely(`https://player.vimeo.com/video/${id}/config`, {
    timeoutMs: 6000,
    maxBytes: 400_000,
  })
  if (!text) return null

  let config: VimeoConfig
  try {
    config = JSON.parse(text)
  } catch {
    return null
  }

  const variants: RawVideo[] = []
  const seen = new Set<string>()
  function push(url: string | null | undefined, isStreaming: boolean, quality?: string) {
    if (!url || seen.has(url)) return
    seen.add(url)
    variants.push({ url, isStreaming, quality })
  }

  for (const file of config.request?.files?.progressive ?? []) {
    push(file.url, false, file.quality)
  }
  for (const cdn of Object.values(config.request?.files?.hls?.cdns ?? {})) {
    push(cdn?.url, true)
  }

  if (variants.length === 0) return null
  const recommended = variants.find((variant) => !variant.isStreaming) ?? variants[0]
  return { ...recommended, variants }
}

export interface YouTubeEmbed {
  id: string
  title: string
  author: string
  thumbnailUrl: string
}

interface OEmbed {
  title?: string
  author_name?: string
}

// YouTube moves its media over POST to /videoplayback as `application/vnd.yt-ump`
// (their SABR protocol), so there is no file URL to capture — no amount of
// network watching will produce one. What is openly available is oEmbed
// metadata and the poster frame, so that is what gets returned. The scan
// reports the video itself as unavailable rather than inventing an asset.
async function resolveYouTube(id: string): Promise<YouTubeEmbed | null> {
  const text = await fetchTextSafely(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${id}`
    )}&format=json`,
    { timeoutMs: 6000, maxBytes: 20_000 }
  )
  if (!text) return null

  let data: OEmbed
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }

  return {
    id,
    title: data.title ?? `YouTube video ${id}`,
    author: data.author_name ?? "",
    // oEmbed only ever offers hqdefault; maxres is the full-size poster frame.
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
  }
}

function idsIn(pattern: RegExp, sources: string[]): string[] {
  const ids = new Set<string>()
  for (const source of sources) {
    // Shared regexes are stateful with /g; reset before reuse.
    pattern.lastIndex = 0
    for (const match of source.matchAll(pattern)) ids.add(match[1])
  }
  return [...ids]
}

/**
 * YouTube links and embeds on a page, resolved to title plus poster frame.
 * Separate from the video resolvers because it deliberately yields no video.
 */
export async function resolveYouTubeEmbeds(
  iframeUrls: string[],
  html: string
): Promise<YouTubeEmbed[]> {
  const ids = idsIn(YOUTUBE_ID, [...iframeUrls, html.replaceAll("\\/", "/")])
  if (ids.length === 0) return []

  const resolved = await mapWithConcurrency(ids.slice(0, MAX_EMBEDS), 4, resolveYouTube)
  return resolved.filter((embed): embed is YouTubeEmbed => embed !== null)
}

// Resolves every recognised player embed on the page into downloadable files.
// `html` is scanned alongside the parsed iframes because plenty of sites ship
// the embed URL inside a script payload and mount the iframe client-side.
export async function resolveEmbedVideos(
  iframeUrls: string[],
  html: string
): Promise<RawVideo[]> {
  const sources = [...iframeUrls, html.replaceAll("\\/", "/")]
  const videoPressIds = idsIn(VIDEOPRESS_GUID, sources)
  const vimeoIds = idsIn(VIMEO_ID, sources)
  if (videoPressIds.length === 0 && vimeoIds.length === 0) return []

  const [videoPress, vimeo] = await Promise.all([
    mapWithConcurrency(videoPressIds.slice(0, MAX_EMBEDS), 4, resolveVideoPress),
    mapWithConcurrency(vimeoIds.slice(0, MAX_EMBEDS), 4, resolveVimeo),
  ])
  return [...videoPress, ...vimeo].filter(
    (video): video is RawVideo => video !== null
  )
}
