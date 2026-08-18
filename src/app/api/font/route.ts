import { sniffFormat, toInstallableFont } from "@/lib/pullsrc/font-convert"
import { decodeWoff2 } from "@/lib/pullsrc/server/font-woff2"
import {
  assertSafePublicUrl,
  fetchWithTimeout,
  UnsafeUrlError,
} from "@/lib/pullsrc/server/http"

// /api/download hands the file over untouched, which for a web font means a
// .woff2 the user can't install. This route unwraps it into the TTF/OTF the
// foundry shipped first.

export const dynamic = "force-dynamic"

// Unwrapping buffers the whole file, so cap it well clear of any real face.
const MAX_FONT_BYTES = 8 * 1024 * 1024

function sanitizeFilename(name: string): string {
  return name.replace(/["\r\n]/g, "").slice(0, 200) || "font"
}

function withExtension(name: string, extension: string): string {
  const match = /\.([a-z0-9]{1,5})$/i.exec(name)
  if (match && match[1].toLowerCase() === extension) return name
  return `${match ? name.slice(0, match.index) : name}.${extension}`
}

const CONTENT_TYPE: Record<string, string> = {
  ttf: "font/ttf",
  otf: "font/otf",
  ttc: "font/collection",
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const target = searchParams.get("url")
  const suggestedName = searchParams.get("name")
  const referer = searchParams.get("referer")

  if (!target) return new Response("Missing url", { status: 400 })

  let fontUrl: URL
  try {
    fontUrl = assertSafePublicUrl(target)
  } catch (error) {
    if (error instanceof UnsafeUrlError) {
      return new Response(error.message, { status: 400 })
    }
    throw error
  }

  let sourcePage: URL | null = null
  if (referer) {
    try {
      sourcePage = assertSafePublicUrl(referer)
    } catch {
      // A bad optional referer should never block the conversion.
    }
  }

  let upstream: Response
  try {
    upstream = await fetchWithTimeout(fontUrl.toString(), {
      timeoutMs: 15000,
      headers: sourcePage ? { referer: sourcePage.toString() } : undefined,
    })
  } catch {
    return new Response("Couldn't fetch that font", { status: 502 })
  }

  if (!upstream.ok) {
    return new Response("Couldn't fetch that font", { status: 502 })
  }

  // Serving a login page as a .ttf is worse than failing: it looks fine.
  if ((upstream.headers.get("content-type") ?? "").includes("text/html")) {
    return new Response(
      "That link has expired — the site returned a web page instead of the font. Re-scan the page to get a fresh link.",
      { status: 410 }
    )
  }

  const body = new Uint8Array(await upstream.arrayBuffer())
  if (body.byteLength > MAX_FONT_BYTES) {
    return new Response("That font is too large to convert", { status: 413 })
  }

  const fallbackName =
    suggestedName || fontUrl.pathname.split("/").filter(Boolean).pop() || "font"

  return convertToResponse(body, fallbackName)
}

/**
 * The extension fetches fonts in the user's own session so login-gated pages
 * still work. When it can't unwrap one itself it posts the bytes here rather
 * than asking the server to re-fetch a URL it may not be allowed to reach.
 */
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url)
  const suggestedName = searchParams.get("name") || "font"

  const body = new Uint8Array(await request.arrayBuffer())
  if (body.byteLength === 0) return new Response("Empty body", { status: 400 })
  if (body.byteLength > MAX_FONT_BYTES) {
    return new Response("That font is too large to convert", { status: 413 })
  }

  return convertToResponse(body, suggestedName)
}

async function convertToResponse(
  body: Uint8Array,
  fallbackName: string
): Promise<Response> {
  // Only the magic bytes decide. A URL's extension is a guess, and returning
  // an error page or a stray HTML fragment under a .ttf name would look like
  // a working download right up until the user tried to install it.
  const format = sniffFormat(body)
  if (!format) {
    return new Response("That file isn't a font", { status: 422 })
  }

  let converted
  try {
    converted = await toInstallableFont(body, format, decodeWoff2)
  } catch (error) {
    return new Response(
      `Couldn't convert that font: ${(error as Error).message}`,
      { status: 422 }
    )
  }

  const filename = withExtension(
    sanitizeFilename(fallbackName),
    converted.extension
  )

  return new Response(converted.bytes as BodyInit, {
    headers: {
      "content-type": CONTENT_TYPE[converted.extension] ?? "font/sfnt",
      "content-length": String(converted.bytes.byteLength),
      "content-disposition": `attachment; filename="${filename}"`,
    },
  })
}
