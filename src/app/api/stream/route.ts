import { resolveHls, type HlsSegment } from "@/lib/pullsrc/server/hls";
import {
  assertSafePublicUrl,
  fetchWithTimeout,
  UnsafeUrlError,
} from "@/lib/pullsrc/server/http";

export const dynamic = "force-dynamic";

// Same ceiling as the scan route — a Hobby function gets 60s and no more, so
// the caps below exist to fail with a clear message instead of a truncated file.
export const maxDuration = 60;

const MAX_BYTES = 200 * 1024 * 1024;
const MAX_SEGMENTS = 4000;

function sanitizeFilename(name: string): string {
  return name.replace(/["\r\n]/g, "").slice(0, 200) || "video";
}

function withExtension(name: string, ext: string): string {
  const match = /\.([a-z0-9]{1,5})$/i.exec(name);
  if (match && match[1].toLowerCase() === ext) return name;
  return `${match ? name.slice(0, match.index) : name}.${ext}`;
}

// A byte range is a request the origin may ignore: some CDNs answer 200 with
// the whole file. Slicing on a 200 keeps the output correct either way.
async function fetchSegment(
  segment: HlsSegment,
  referer: string | null,
): Promise<Uint8Array> {
  const headers: Record<string, string> = {};
  if (referer) headers.referer = referer;
  if (segment.range) {
    const { offset, length } = segment.range;
    headers.range = `bytes=${offset}-${offset + length - 1}`;
  }

  const res = await fetchWithTimeout(segment.url, { timeoutMs: 15000, headers });
  if (!res.ok) throw new Error(`segment responded ${res.status}`);

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (segment.range && res.status !== 206) {
    const { offset, length } = segment.range;
    return bytes.slice(offset, offset + length);
  }
  return bytes;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const target = searchParams.get("url");
  const suggestedName = searchParams.get("name");
  const refererParam = searchParams.get("referer");

  if (!target) return new Response("Missing url", { status: 400 });

  let playlistUrl: URL;
  try {
    playlistUrl = assertSafePublicUrl(target);
  } catch (error) {
    if (error instanceof UnsafeUrlError) {
      return new Response(error.message, { status: 400 });
    }
    throw error;
  }

  let referer: string | null = null;
  if (refererParam) {
    try {
      referer = assertSafePublicUrl(refererParam).toString();
    } catch {
      // An unusable referer shouldn't block the download.
    }
  }

  const media = await resolveHls(playlistUrl.toString());
  if (!media || media.segments.length === 0) {
    return new Response("Couldn't read that stream's playlist", { status: 502 });
  }
  if (media.segments.length > MAX_SEGMENTS) {
    return new Response(
      `That stream has ${media.segments.length} segments, more than this can assemble in one request. Try a shorter video.`,
      { status: 413 },
    );
  }

  const extension = media.container === "fmp4" ? "mp4" : "ts";
  const filename = withExtension(
    sanitizeFilename(
      suggestedName ??
        playlistUrl.pathname.split("/").filter(Boolean).pop() ??
        "video",
    ),
    extension,
  );

  // Every segment is a range into one file, which is itself a complete fMP4 —
  // stream that straight through rather than reassembling it piece by piece.
  if (media.wholeFileUrl) {
    const res = await fetchWithTimeout(media.wholeFileUrl, {
      timeoutMs: 20000,
      headers: referer ? { referer } : undefined,
    }).catch(() => null);

    if (res?.ok && res.body) {
      return new Response(res.body, {
        headers: {
          "content-type":
            media.container === "fmp4" ? "video/mp4" : "video/mp2t",
          "content-disposition": `attachment; filename="${filename}"`,
          ...(res.headers.get("content-length")
            ? { "content-length": res.headers.get("content-length")! }
            : {}),
        },
      });
    }
    // Fall through to segment assembly if the whole-file fetch didn't work.
  }

  const queue = media.init ? [media.init, ...media.segments] : media.segments;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let written = 0;
      try {
        for (const segment of queue) {
          const bytes = await fetchSegment(segment, referer);
          written += bytes.length;
          if (written > MAX_BYTES) {
            // Nothing useful can be salvaged from a half file, so error rather
            // than let the browser save a broken one.
            controller.error(
              new Error("Stream exceeded the maximum assembled size"),
            );
            return;
          }
          controller.enqueue(bytes);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": media.container === "fmp4" ? "video/mp4" : "video/mp2t",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
