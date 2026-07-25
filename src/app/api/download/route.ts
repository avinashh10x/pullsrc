import { assertSafePublicUrl, fetchWithTimeout, UnsafeUrlError } from "@/lib/pullsrc/server/http"

export const dynamic = "force-dynamic"

function sanitizeFilename(name: string): string {
  return name.replace(/["\r\n]/g, "").slice(0, 200) || "download"
}

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/ogg": "ogv",
  "font/woff2": "woff2",
  "font/woff": "woff",
  "font/ttf": "ttf",
  "font/sfnt": "ttf",
  "font/otf": "otf",
  "application/font-woff2": "woff2",
  "application/font-woff": "woff",
  "application/x-font-ttf": "ttf",
}

// The source URL doesn't always carry a real extension, so trust the
// upstream Content-Type over whatever name the caller supplied.
function withCorrectExtension(filename: string, contentType: string | null): string {
  const base = contentType?.split(";")[0]?.trim().toLowerCase() ?? ""
  const ext = EXTENSION_BY_CONTENT_TYPE[base]
  if (!ext) return filename

  const match = /\.([a-z0-9]{1,5})$/i.exec(filename)
  if (match && match[1].toLowerCase() === ext) return filename
  return `${match ? filename.slice(0, match.index) : filename}.${ext}`
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const target = searchParams.get("url")
  const suggestedName = searchParams.get("name")

  if (!target) {
    return new Response("Missing url", { status: 400 })
  }

  let assetUrl: URL
  try {
    assetUrl = assertSafePublicUrl(target)
  } catch (error) {
    if (error instanceof UnsafeUrlError) {
      return new Response(error.message, { status: 400 })
    }
    throw error
  }

  let upstream: Response
  try {
    upstream = await fetchWithTimeout(assetUrl.toString(), { timeoutMs: 15000 })
  } catch {
    return new Response("Couldn't fetch that asset", { status: 502 })
  }

  if (!upstream.ok || !upstream.body) {
    return new Response("Couldn't fetch that asset", { status: 502 })
  }

  const contentType = upstream.headers.get("content-type")
  const filename = withCorrectExtension(
    sanitizeFilename(suggestedName || assetUrl.pathname.split("/").filter(Boolean).pop() || "download"),
    contentType
  )

  return new Response(upstream.body, {
    headers: {
      "content-type": contentType ?? "application/octet-stream",
      "content-disposition": `attachment; filename="${filename}"`,
      ...(upstream.headers.get("content-length")
        ? { "content-length": upstream.headers.get("content-length")! }
        : {}),
    },
  })
}
