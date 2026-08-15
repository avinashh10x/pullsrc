// What a URL is, independent of how it was observed: the app feeds this from
// Playwright, the extension from chrome.webRequest. Keep it platform-free.

export type MediaKind = "video" | "audio" | "model3d";

export interface MediaClassification {
  kind: MediaKind;
  isStreaming: boolean;
}

export const VIDEO_EXT =
  /\.(mp4|webm|mov|m4v|ogv|avi|mkv|3gp|mts|m2ts|asf|wmv|flv|f4v|hevc|vob|m2v|mxf|vp8|vp9)(?:\?|#|$)/i;
export const AUDIO_EXT =
  /\.(mp3|wav|ogg|m4a|flac|aac|weba|opus|aiff|alac|wma|m4b|dsd|ape)(?:\?|#|$)/i;
export const MODEL_EXT =
  /\.(glb|gltf|usdz|obj|fbx|dae|stl|ply|3mf|vrm|x3d|wrl|splat|blend|iges|step|stp)(?:\?|#|$)/i;
export const IMAGE_EXT =
  /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|tiff|heif|heic|avif|evif)(?:\?|#|$)/i;
export const FONT_EXT = /\.(woff2|woff|ttf|otf|eot|ttc)(?:\?|#|$)/i;
export const MANIFEST_EXT = /\.(m3u8|mpd)(?:\?|#|$)/i;
// HLS/DASH segment/fragment files — chunks of a stream, not standalone videos
const SEGMENT_EXT = /\.(ts|m4s)(?:\?|#|$)/i;
// Adaptive-stream renditions split the audio track into its own file/manifest
// (e.g. foo_dvd.audio.m3u8) — that's audio, not a video, even though it sits
// right next to the real video variants under the same content-type/manifest rules.
const AUDIO_ONLY_HINT =
  /(?:[._-]audio|audio[._-]|\/audio\/).*(?:m3u8|mpd|mp4|m4a|aac|opus)(?:\?|#|$)/i;

// Instagram puts its byte window in the query string, not a Range header, so
// one file arrives as a dozen slices and dedup keeps whichever landed first —
// usually a 248-byte fragment. Dropping these collapses them onto one URL.
const RANGE_QUERY_PARAMS = ["bytestart", "byteend"];

export function canonicalMediaUrl(url: string): string {
  try {
    const parsed = new URL(url);
    let touched = false;
    for (const param of RANGE_QUERY_PARAMS) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.delete(param);
        touched = true;
      }
    }
    return touched ? parsed.toString() : url;
  } catch {
    return url;
  }
}

// YouTube POSTs to /videoplayback and reads back `application/vnd.yt-ump`, so
// a captured googlevideo URL is never a fetchable file.
const UNFETCHABLE_MEDIA_HOST =
  /(?:^|\.)(?:googlevideo\.com|youtube\.com|youtube-nocookie\.com)$/i;

export function classifyMediaUrl(
  url: string,
  contentType: string,
): MediaClassification | null {
  // Match the path, not the whole URL: `https://studio.blend` was being read
  // as a .blend file and listed as a 3D model.
  let path: string;
  try {
    const parsed = new URL(url);
    if (UNFETCHABLE_MEDIA_HOST.test(parsed.hostname)) return null;
    path = parsed.pathname;
  } catch {
    return null;
  }

  if (SEGMENT_EXT.test(path)) return null;

  // Reject images even when the server calls them video/audio (.evif etc).
  if (IMAGE_EXT.test(path)) return null;

  // Deliberately no filename filter for "UI sounds": /sfx/ and whoosh.mp3 are
  // exactly what people come here for. YouTube's beeps go by host, above.

  const isManifest =
    MANIFEST_EXT.test(path) || /mpegurl|dash\+xml/i.test(contentType);

  if (AUDIO_ONLY_HINT.test(path))
    return { kind: "audio", isStreaming: isManifest };

  if (isManifest) return { kind: "video", isStreaming: true };

  // Extension beats content-type: servers mislabel more often than paths lie.
  if (VIDEO_EXT.test(path)) return { kind: "video", isStreaming: false };
  if (AUDIO_EXT.test(path)) return { kind: "audio", isStreaming: false };
  if (MODEL_EXT.test(path)) return { kind: "model3d", isStreaming: false };

  if (contentType.startsWith("video/"))
    return { kind: "video", isStreaming: false };
  if (contentType.startsWith("audio/"))
    return { kind: "audio", isStreaming: false };
  if (
    /(?:model\/|application\/(?:gltf|vnd\.google\.earth\.kml|vnd\.ms-3mf|x-3d|x-3ds|x-tgif))/i.test(
      contentType,
    )
  )
    return { kind: "model3d", isStreaming: false };

  return null;
}
