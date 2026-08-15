// Deciding what a URL is, with no dependency on how it was observed. The web
// app feeds this from Playwright responses; the extension feeds it from
// chrome.webRequest. Keeping it free of Node and Playwright imports is what
// lets both do that, so don't reach for anything platform-specific in here.

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

// Facebook/Instagram players don't use Range headers — they put the window in
// the query string and pull a file down in a dozen `bytestart`/`byteend` slices.
// Captured verbatim, each slice looks like a separate asset, and whichever one
// arrives first wins the dedup: usually a 248-byte fragment from the middle of
// the file. Dropping those two parameters collapses every slice back onto the
// one URL that serves the whole file.
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

// YouTube delivers media by POSTing to /videoplayback and reading back
// `application/vnd.yt-ump`, so a captured googlevideo URL is never a file
// anyone can fetch — and youtube.com itself serves placeholder manifests that
// are equally useless. Listing either produces an asset that always fails.
const UNFETCHABLE_MEDIA_HOST =
  /(?:^|\.)(?:googlevideo\.com|youtube\.com|youtube-nocookie\.com)$/i;

export function classifyMediaUrl(
  url: string,
  contentType: string,
): MediaClassification | null {
  // Extensions must be matched against the path alone. Against the whole URL,
  // a hostname ending in a new gTLD reads as a filename — `https://studio.blend`
  // was being caught by MODEL_EXT and listed as a 3D model.
  let path: string;
  try {
    const parsed = new URL(url);
    if (UNFETCHABLE_MEDIA_HOST.test(parsed.hostname)) return null;
    path = parsed.pathname;
  } catch {
    return null;
  }

  if (SEGMENT_EXT.test(path)) return null;

  // CRITICAL: Reject image files even if server claims they're video/audio
  // This prevents .evif and other images from appearing in wrong tabs
  if (IMAGE_EXT.test(path)) return null;

  // No filename-based filtering of "UI sounds" here. An earlier version dropped
  // paths like /sfx/, click.mp3 and whoosh.mp3 to hide YouTube's four player
  // beeps — but those are exactly the sound effects a designer comes here for,
  // and YouTube is already excluded by host above. Blocking by host is precise;
  // blocking by filename guesses, and it guessed wrong.

  const isManifest =
    MANIFEST_EXT.test(path) || /mpegurl|dash\+xml/i.test(contentType);

  // Audio-only hint takes precedence
  if (AUDIO_ONLY_HINT.test(path))
    return { kind: "audio", isStreaming: isManifest };

  // Manifest (HLS/DASH) streaming
  if (isManifest) return { kind: "video", isStreaming: true };

  // PRIORITIZE FILE EXTENSION over content-type to prevent misclassification
  // Only use content-type as fallback if no extension recognized
  if (VIDEO_EXT.test(path)) return { kind: "video", isStreaming: false };
  if (AUDIO_EXT.test(path)) return { kind: "audio", isStreaming: false };
  if (MODEL_EXT.test(path)) return { kind: "model3d", isStreaming: false };

  // Fallback: use content-type only when extension isn't recognized
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
