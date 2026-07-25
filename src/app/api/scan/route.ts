import * as cheerio from "cheerio"

import {
  assertSafePublicUrl,
  fetchTextSafely,
  fetchWithTimeout,
  formatBytes,
  headSafely,
  mapWithConcurrency,
  UnsafeUrlError,
} from "@/lib/pullsrc/server/http"
import {
  extractAudio,
  extractIcons,
  extractImages,
  extractInlineStyleText,
  extractModels,
  extractOgImage,
  extractPreloadFonts,
  extractStylesheetUrls,
  extractTitle,
  extractVideos,
  parseColors,
  parseFontFaces,
  type RawAudio,
  type RawFont,
  type RawModel3D,
  type RawVideo,
} from "@/lib/pullsrc/server/extract"
import { captureNetworkMedia, type RawNetworkMedia } from "@/lib/pullsrc/server/network-media"
import type {
  AudioAsset,
  ColorAsset,
  CreditInfo,
  FontAsset,
  ImageAsset,
  LogoAsset,
  Model3DAsset,
  ScanError,
  ScanStreamEvent,
  VideoAsset,
} from "@/lib/pullsrc/types"

export const dynamic = "force-dynamic"

function fileTypeFromUrl(url: string, fallback: string): string {
  const match = /\.([a-z0-9]{2,5})(?:\?|#|$)/i.exec(url)
  return match ? match[1].toUpperCase() : fallback
}

function nameFromUrl(url: string): string {
  try {
    const { pathname } = new URL(url)
    const last = pathname.split("/").filter(Boolean).pop()
    return last ? decodeURIComponent(last) : url
  } catch {
    return url
  }
}

// Image-optimizer URLs (/_next/image?url=...) have no real extension, so
// nameFromUrl alone can yield a bare "image" — append the detected fileType.
function ensureFileExtension(name: string, fileType: string): string {
  const ext = fileType.toLowerCase()
  if (!/^[a-z0-9]{1,5}$/.test(ext)) return name
  const match = /\.([a-z0-9]{1,5})$/i.exec(name)
  if (match && match[1].toLowerCase() === ext) return name
  return `${match ? name.slice(0, match.index) : name}.${ext}`
}

function familyFromFontFileName(url: string): string {
  const base = nameFromUrl(url).replace(/\.[a-z0-9]+$/i, "")
  return base.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

const WEIGHT_ORDER = [
  "100",
  "200",
  "300",
  "400",
  "normal",
  "500",
  "600",
  "700",
  "bold",
  "800",
  "900",
]

function sortWeights(weights: string[]): string[] {
  return [...weights].sort(
    (a, b) => WEIGHT_ORDER.indexOf(a.toLowerCase()) - WEIGHT_ORDER.indexOf(b.toLowerCase())
  )
}

function ndjson(event: ScanStreamEvent): string {
  return JSON.stringify(event) + "\n"
}

// Every response is an NDJSON stream, even validation failures, so the
// client only ever has one code path instead of branching on response shape.
function ndjsonErrorResponse(error: ScanError): Response {
  const body = ndjson({ type: "error", error }) + ndjson({ type: "done" })
  return new Response(body, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8" },
  })
}

async function runScan(pageUrl: URL, send: (event: ScanStreamEvent) => void) {
  const pageUrlString = pageUrl.toString()

  let html: string
  try {
    const res = await fetchWithTimeout(pageUrlString, {
      timeoutMs: 10000,
      headers: { accept: "text/html,application/xhtml+xml" },
    })

    if (res.status === 401 || res.status === 403 || res.status === 451 || res.status === 429) {
      send({
        type: "error",
        error: {
          kind: "blocked",
          message: `The page responded with ${res.status} — it may require a login, sit behind a paywall, or be blocking automated scans.`,
        },
      })
      send({ type: "done" })
      return
    }

    if (!res.ok) {
      send({ type: "error", error: { kind: "broken", message: `The page responded with ${res.status}.` } })
      send({ type: "done" })
      return
    }

    html = await res.text()
  } catch {
    send({ type: "error", error: { kind: "broken", message: "We couldn't reach that page." } })
    send({ type: "done" })
    return
  }

  const $ = cheerio.load(html)
  const title = extractTitle($) || pageUrl.hostname
  const scanDate = new Date().toISOString().slice(0, 10)

  send({ type: "meta", pageUrl: pageUrlString, pageTitle: title, sourceDomain: pageUrl.hostname, scanDate })

  const credit: CreditInfo = {
    sourceDomain: pageUrl.hostname,
    pageTitle: title,
    originalUrl: pageUrlString,
    scanDate,
  }

  // --- video / audio / 3d models — kicked off first since the headless
  // browser pass is the slow part; everything below runs concurrently with it
  const seenVideoUrls = new Set<string>()
  const seenAudioUrls = new Set<string>()
  const seenModelUrls = new Set<string>()
  let videoIndex = 0
  let audioIndex = 0
  let modelIndex = 0
  let streamingDrmChecks = 0
  const pendingMedia: Promise<void>[] = []

  async function emitVideo(raw: RawVideo) {
    if (seenVideoUrls.has(raw.url) || seenVideoUrls.size >= 24) return
    seenVideoUrls.add(raw.url)
    const index = videoIndex++

    let drm = false
    let meta: Awaited<ReturnType<typeof headSafely>> = null
    if (raw.isStreaming) {
      if (streamingDrmChecks < 6) {
        streamingDrmChecks++
        const text = await fetchTextSafely(raw.url, { timeoutMs: 5000, maxBytes: 50_000 })
        drm = text ? /#EXT-X-KEY[^\n]*METHOD=(?!NONE)/i.test(text) : false
      }
    } else {
      meta = await headSafely(raw.url)
    }

    const fileType = raw.isStreaming ? "HLS" : fileTypeFromUrl(raw.url, "MP4")
    const asset: VideoAsset = {
      id: `video-${index}`,
      category: "video",
      name: raw.isStreaming ? nameFromUrl(raw.url) : ensureFileExtension(nameFromUrl(raw.url), fileType),
      url: raw.url,
      wasStreaming: raw.isStreaming,
      drmProtected: raw.isStreaming ? drm : undefined,
      fileType,
      size: raw.isStreaming ? "—" : formatBytes(meta?.contentLength ?? null),
      credit,
    }
    send({ type: "asset", asset })
  }

  async function emitAudio(raw: RawAudio) {
    if (seenAudioUrls.has(raw.url) || seenAudioUrls.size >= 24) return
    seenAudioUrls.add(raw.url)
    const index = audioIndex++

    const meta = await headSafely(raw.url)
    const fileType = fileTypeFromUrl(raw.url, "AUDIO")
    const asset: AudioAsset = {
      id: `audio-${index}`,
      category: "audio",
      name: ensureFileExtension(nameFromUrl(raw.url), fileType),
      url: raw.url,
      fileType,
      size: formatBytes(meta?.contentLength ?? null),
      credit,
    }
    send({ type: "asset", asset })
  }

  async function emitModel(raw: RawModel3D) {
    if (seenModelUrls.has(raw.url) || seenModelUrls.size >= 24) return
    seenModelUrls.add(raw.url)
    const index = modelIndex++

    const meta = await headSafely(raw.url)
    const fileType = fileTypeFromUrl(raw.url, "GLB")
    const asset: Model3DAsset = {
      id: `model3d-${index}`,
      category: "model3d",
      name: ensureFileExtension(nameFromUrl(raw.url), fileType),
      url: raw.url,
      fileType,
      size: formatBytes(meta?.contentLength ?? null),
      credit,
    }
    send({ type: "asset", asset })
  }

  function onNetworkMedia(media: RawNetworkMedia) {
    const promise =
      media.kind === "video"
        ? emitVideo({ url: media.url, isStreaming: media.isStreaming })
        : media.kind === "audio"
          ? emitAudio({ url: media.url })
          : emitModel({ url: media.url })
    pendingMedia.push(promise)
  }

  const networkMediaDone = captureNetworkMedia(pageUrlString, onNetworkMedia)

  for (const video of extractVideos($, html, pageUrlString)) pendingMedia.push(emitVideo(video))
  for (const audio of extractAudio($, html, pageUrlString)) pendingMedia.push(emitAudio(audio))
  for (const model of extractModels($, html, pageUrlString)) pendingMedia.push(emitModel(model))

  // --- images + logo candidate ---------------------------------------------
  const ogImage = extractOgImage($, pageUrlString)
  const scannedImages = extractImages($, pageUrlString)
  // og:image is often hosted elsewhere and never appears as an <img> tag, so
  // it's merged in explicitly, prepended so it survives the later 24-image cap.
  const rawImages =
    ogImage && !scannedImages.some((img) => img.url === ogImage.url)
      ? [ogImage, ...scannedImages]
      : scannedImages
  const rawIcons = extractIcons($, pageUrlString)

  const logoCandidate =
    rawImages.find((img) => img.looksLikeLogo) ??
    (() => {
      const appleIcon = rawIcons.find((icon) => /apple-touch-icon/i.test(icon))
      return appleIcon ? { url: appleIcon, alt: "", looksLikeLogo: true } : null
    })()

  const imagesWithoutLogo = rawImages.filter((img) => img.url !== logoCandidate?.url)
  const boundedImages = imagesWithoutLogo.slice(0, 24)

  const [imageMeta, logoMeta] = await Promise.all([
    mapWithConcurrency(boundedImages, 6, (img) => headSafely(img.url)),
    logoCandidate ? headSafely(logoCandidate.url) : Promise.resolve(null),
  ])

  const imageAssets: ImageAsset[] = boundedImages.map((img, index) => {
    const fileType = fileTypeFromUrl(
      img.url,
      imageMeta[index]?.contentType?.split("/")[1]?.toUpperCase() ?? "IMG"
    )
    return {
      id: `image-${index}`,
      category: "images",
      name: ensureFileExtension(nameFromUrl(img.url), fileType),
      url: img.url,
      fileType,
      size: formatBytes(imageMeta[index]?.contentLength ?? null),
      credit,
    }
  })

  const logoAssets: LogoAsset[] = logoCandidate
    ? [
        (() => {
          const fileType = fileTypeFromUrl(
            logoCandidate.url,
            logoMeta?.contentType?.split("/")[1]?.toUpperCase() ?? "IMG"
          )
          return {
            id: "logo-0",
            category: "logo" as const,
            name: ensureFileExtension(nameFromUrl(logoCandidate.url), fileType),
            url: logoCandidate.url,
            fileType,
            size: formatBytes(logoMeta?.contentLength ?? null),
            confidence: "likely" as const,
            credit,
          }
        })(),
      ]
    : []

  send({ type: "category", category: "logo", assets: logoAssets })
  send({ type: "category-done", category: "logo" })
  send({ type: "category", category: "images", assets: imageAssets })
  send({ type: "category-done", category: "images" })

  // --- fonts + colors from stylesheets ------------------------------------
  const stylesheetUrls = extractStylesheetUrls($, pageUrlString)
  const inlineCss = extractInlineStyleText($)
  const preloadFontUrls = extractPreloadFonts($, pageUrlString)

  const stylesheetTexts = await mapWithConcurrency(stylesheetUrls, 4, (url) =>
    fetchTextSafely(url, { timeoutMs: 6000, maxBytes: 400_000 })
  )

  const rawFontsFromCss: RawFont[] = stylesheetUrls.flatMap((url, index) => {
    const text = stylesheetTexts[index]
    return text ? parseFontFaces(text, url) : []
  })

  const rawFontsFromPreload: RawFont[] = preloadFontUrls.map((url) => ({
    fontFamily: familyFromFontFileName(url),
    weight: "—",
    url,
  }))

  const fontsByFamily = new Map<string, { url: string; weights: Set<string> }>()
  for (const font of [...rawFontsFromCss, ...rawFontsFromPreload]) {
    const existing = fontsByFamily.get(font.fontFamily)
    if (existing) {
      existing.weights.add(font.weight)
    } else {
      fontsByFamily.set(font.fontFamily, { url: font.url, weights: new Set([font.weight]) })
    }
  }

  const fontEntries = [...fontsByFamily.entries()].slice(0, 12)
  const fontMeta = await mapWithConcurrency(fontEntries, 6, ([, info]) => headSafely(info.url))

  const fontAssets: FontAsset[] = fontEntries.map(([fontFamily, info], index) => ({
    id: `font-${index}`,
    category: "fonts",
    name: nameFromUrl(info.url),
    url: info.url,
    fontFamily,
    weights: sortWeights([...info.weights]),
    fileType: fileTypeFromUrl(info.url, "FONT"),
    size: formatBytes(fontMeta[index]?.contentLength ?? null),
    credit,
  }))

  send({ type: "category", category: "fonts", assets: fontAssets })
  send({ type: "category-done", category: "fonts" })

  const allCss = [inlineCss, ...stylesheetTexts.filter((t): t is string => Boolean(t))].join("\n")
  const colorAssets: ColorAsset[] = parseColors(allCss).map((hex, index) => ({
    id: `color-${index}`,
    category: "colors",
    name: hex.toUpperCase(),
    hex,
    fileType: "HEX",
    size: "—",
    credit,
  }))

  send({ type: "category", category: "colors", assets: colorAssets })
  send({ type: "category-done", category: "colors" })

  // wait on the browser session plus any per-asset lookups still in flight
  await networkMediaDone
  await Promise.all(pendingMedia)

  send({ type: "category-done", category: "video" })
  send({ type: "category-done", category: "audio" })
  send({ type: "category-done", category: "model3d" })

  send({ type: "done" })
}

export async function POST(request: Request) {
  let body: { url?: string }
  try {
    body = await request.json()
  } catch {
    return ndjsonErrorResponse({ kind: "invalid", message: "Bad request body" })
  }

  const raw = body.url?.trim()
  if (!raw) {
    return ndjsonErrorResponse({ kind: "invalid", message: "Missing url" })
  }

  let pageUrl: URL
  try {
    pageUrl = assertSafePublicUrl(raw)
  } catch (error) {
    if (error instanceof UnsafeUrlError) {
      return ndjsonErrorResponse({ kind: "invalid", message: error.message })
    }
    throw error
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ScanStreamEvent) => controller.enqueue(encoder.encode(ndjson(event)))
      try {
        await runScan(pageUrl, send)
      } catch {
        send({ type: "error", error: { kind: "broken", message: "Something went wrong while scanning." } })
        send({ type: "done" })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache",
    },
  })
}
