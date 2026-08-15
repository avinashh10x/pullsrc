import * as cheerio from "cheerio";

import {
  assertSafePublicUrl,
  fetchTextSafely,
  fetchWithTimeout,
  formatBytes,
  headSafely,
  mapWithConcurrency,
  UnsafeUrlError,
} from "@/lib/pullsrc/server/http";
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
} from "@/lib/pullsrc/server/extract";
import {
  extractIframeUrls,
  resolveEmbedVideos,
  resolveYouTubeEmbeds,
} from "@/lib/pullsrc/server/embeds";
import {
  captureNetworkMedia,
  type RawNetworkMedia,
} from "@/lib/pullsrc/server/network-media";
import { isBareSegment, probeMp4Track } from "@/lib/pullsrc/server/media-probe";
import type {
  AudioAsset,
  ColorAsset,
  CreditInfo,
  FontAsset,
  ImageAsset,
  LogoAsset,
  MediaVariant,
  Model3DAsset,
  ScanError,
  ScanStreamEvent,
  VideoAsset,
} from "@/lib/pullsrc/types";

export const dynamic = "force-dynamic";

// Inflating the serverless Chromium and driving a full scroll/click pass takes
// well past the platform default — a scan of a heavy 3D site runs ~15s before
// cold start is even counted. 60s is the Hobby-plan ceiling.
export const maxDuration = 60;

// A page can legitimately have a gallery, soundtrack, or model library. Keep
// a generous guardrail so one pathological page cannot exhaust a request.
const MAX_MEDIA_ASSETS_PER_KIND = 100;

function fileTypeFromUrl(url: string, fallback: string): string {
  const match = /\.([a-z0-9]{2,5})(?:\?|#|$)/i.exec(url);
  return match ? match[1].toUpperCase() : fallback;
}

// Extract file type from Content-Type header when URL has no extension
function fileTypeFromContentType(
  contentType: string | null | undefined,
): string | null {
  if (!contentType) return null;
  const type = contentType.split("/")[1]?.split(";")[0]?.trim().toUpperCase();
  if (!type) return null;
  // Map common MIME types to file extensions
  const mimeMap: Record<string, string> = {
    mp4: "MP4",
    webm: "WEBM",
    quicktime: "MOV",
    "x-msvideo": "AVI",
    "x-matroska": "MKV",
    ogg: "OGG",
    "3gpp": "3GP",
    mpeg: "MPEG",
    "x-ms-wmv": "WMV",
    "x-flv": "FLV",
    "x-m4v": "M4V",
    "vnd.rn-realmedia": "RM",
    "x-mpegs": "MPEG",
    mpeg3: "MP3",
    wav: "WAV",
    "x-wav": "WAV",
    flac: "FLAC",
    aac: "AAC",
    "x-m4a": "M4A",
    "x-caf": "CAF",
    opus: "OPUS",
    "x-opus+ogg": "OPUS",
    "x-apple-protected-mpeg-4-audio": "M4P",
  };
  return mimeMap[type.toLowerCase()] || type;
}

function nameFromUrl(url: string): string {
  try {
    const { pathname } = new URL(url);
    const last = pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : url;
  } catch {
    return url;
  }
}

// Image-optimizer URLs (/_next/image?url=...) have no real extension, so
// nameFromUrl alone can yield a bare "image" — append the detected fileType.
function ensureFileExtension(name: string, fileType: string): string {
  const ext = fileType.toLowerCase();
  if (!/^[a-z0-9]{1,5}$/.test(ext)) return name;
  const match = /\.([a-z0-9]{1,5})$/i.exec(name);
  if (match && match[1].toLowerCase() === ext) return name;
  return `${match ? name.slice(0, match.index) : name}.${ext}`;
}

// Adaptive-stream CDNs publish several files per video/audio track —
// different qualities, a master playlist, a "dvd" rendition, etc — all
// sharing one directory and a filename prefix up to the first quality/variant
// marker. Grouping on that prefix collapses those into a single
// representative per real asset, without merging genuinely distinct assets
// that happen to share a folder.
// No trailing \b: variant tags are often followed directly by more of the
// same "word" (e.g. "adaptive_4", "adaptive_2-1"), and \b won't match between
// two word characters like "e" and "_" — the leading separator is anchor enough.
const VARIANT_MARKER =
  /[._-](?:dvd|hd|sd|adaptive|playlist|master|thumbgrid|original|subtitles|\d{3,4}p|\d{3,4}x\d{3,4}|\d{3,5}k(?:bps)?)/i;

function mediaGroupKey(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/");
    const filename = segments.pop() ?? "";
    const stem = filename.replace(/\.[a-z0-9]+$/i, "");
    const markerIndex = stem.search(VARIANT_MARKER);
    const base = markerIndex >= 0 ? stem.slice(0, markerIndex) : stem;
    return `${parsed.origin}${segments.join("/")}/${base}`;
  } catch {
    return url;
  }
}

interface MediaCandidate {
  url: string;
  isStreaming: boolean;
  quality?: string;
}

function variantScore(candidate: MediaCandidate): number {
  const lower = candidate.url.toLowerCase();
  // A provider-supplied label beats guessing from the filename: VideoPress
  // names its 720p rendition "_hd" and its 480p one "_dvd", neither of which
  // carries a number to parse.
  const labelled = Number(/^(\d{3,4})p$/i.exec(candidate.quality ?? "")?.[1] ?? 0);
  const quality =
    labelled ||
    Number(/(?:^|[._/?=&-])(\d{3,4})p(?:$|[._/?=&-])/i.exec(lower)?.[1] ?? 0) ||
    Number(
      /(?:^|[._/?=&-])\d{3,4}x(\d{3,4})(?:$|[._/?=&-])/i.exec(lower)?.[1] ?? 0,
    ) ||
    Number(
      /(?:quality|height|resolution|res)[=_-](\d{3,4})/i.exec(lower)?.[1] ?? 0,
    );
  const original =
    /^original$/i.test(candidate.quality ?? "") ||
    /(?:^|[._-])(original|source|master)(?:[._-]|$)/i.test(lower)
      ? 100_000
      : 0;
  // A direct file is the best recommendation for this product because it can
  // actually be downloaded. Streaming-only options remain available as context.
  return (candidate.isStreaming ? 0 : 1_000_000) + original + quality;
}

function groupMediaCandidates<T extends MediaCandidate>(
  candidates: T[],
): Array<T & { variants: T[] }> {
  const grouped = new Map<string, T[]>();
  for (const candidate of candidates) {
    const key = mediaGroupKey(candidate.url);
    const existing = grouped.get(key);
    if (existing?.some((item) => item.url === candidate.url)) continue;
    if (existing) existing.push(candidate);
    else grouped.set(key, [candidate]);
  }
  return [...grouped.values()].map((variants) => {
    const recommended = [...variants].sort(
      (a, b) => variantScore(b) - variantScore(a),
    )[0];
    return { ...recommended, variants };
  });
}

// Picking between renditions is a size-vs-quality call, so both numbers have
// to be real — a list of "—" sizes tells the user nothing. Bounded because
// this is one HEAD per rendition on top of the asset's own.
const MAX_VARIANT_SIZE_LOOKUPS = 10;

// Each probe is a ~4KB ranged read, cheap individually but not free in bulk.
const MAX_TRACK_PROBES = 8;

// Big CDNs shard across numbered edge hosts — one reel's renditions arrive from
// instagram.fbom20-1.fna.fbcdn.net and …fbom20-2.fna.fbcdn.net. Comparing full
// hostnames would call those unrelated, so tracks are matched on the registrable
// tail (fbcdn.net, redd.it) instead.
function cdnGroupOf(url: string): string {
  try {
    return new URL(url).hostname.split(".").slice(-2).join(".");
  } catch {
    return url;
  }
}

interface ReconciledTracks {
  videos: RawVideo[];
  audio: MediaCandidate[];
}

/**
 * The URL-based classifier in network-media.ts can only guess from filenames,
 * which works for CDNs that name tracks honestly and fails completely for ones
 * that don't — fbcdn serves picture, sound and a bare DASH fragment as three
 * identical-looking `AQ…mp4` URLs. Reading each file's `hdlr` box settles it,
 * then a picture-only track and a sound-only track from the same host are
 * folded into one asset instead of being presented as unrelated finds.
 */
async function reconcileTracks(
  videos: RawVideo[],
  audio: MediaCandidate[],
): Promise<ReconciledTracks> {
  const probable = videos.filter(
    (video) => !video.isStreaming && /\.mp4(?:\?|#|$)/i.test(video.url),
  );
  if (probable.length < 2) return { videos, audio };

  const probes = await mapWithConcurrency(
    probable.slice(0, MAX_TRACK_PROBES),
    4,
    (video) => probeMp4Track(video.url),
  );
  const tracksByUrl = new Map(
    probable.slice(0, MAX_TRACK_PROBES).map((video, i) => [video.url, probes[i]]),
  );

  const keptVideos: RawVideo[] = [];
  const promotedAudio: MediaCandidate[] = [];
  const unknown: RawVideo[] = [];

  for (const video of videos) {
    const tracks = tracksByUrl.get(video.url);
    if (!tracks) {
      // No verdict: either not probed, or `moov` sits past the probe window.
      unknown.push(video);
      continue;
    }
    if (tracks.kind === "audio") promotedAudio.push({ ...video });
    else keptVideos.push(video);
  }

  // A probe that found no `moov` at all on a URL sitting beside tracks that did
  // is a bare DASH fragment — unplayable on its own, so it's noise, not an asset.
  const anyProbeSucceeded = probes.some(Boolean);
  const carriedUnknown = anyProbeSucceeded
    ? await (async () => {
        const verdicts = await mapWithConcurrency(
          unknown.slice(0, MAX_TRACK_PROBES),
          4,
          (video) =>
            video.isStreaming
              ? Promise.resolve(false)
              : isBareSegment(video.url),
        );
        return unknown.filter((_, i) => !verdicts[i]);
      })()
    : unknown;

  const allVideos = [...keptVideos, ...carriedUnknown];
  const allAudio = [...audio, ...promotedAudio];

  // Silent picture tracks from one host are renditions of the same video — a
  // reel arrives as a 3 MB and a 12 MB copy of identical footage. Presenting
  // them as separate finds is noise, so the biggest becomes the asset and the
  // rest become quality options on it.
  const silent = allVideos.filter((video) => tracksByUrl.get(video.url)?.silent);
  if (silent.length === 0) return { videos: allVideos, audio: allAudio };

  const group = cdnGroupOf(silent[0].url);
  if (!silent.every((video) => cdnGroupOf(video.url) === group)) {
    return { videos: allVideos, audio: allAudio };
  }

  const sizes = await mapWithConcurrency(silent, 4, (video) =>
    headSafely(video.url),
  );
  const ranked = silent
    .map((video, i) => ({ video, bytes: sizes[i]?.contentLength ?? 0 }))
    .sort((a, b) => b.bytes - a.bytes);

  const partner = allAudio.find((track) => cdnGroupOf(track.url) === group);
  const primary: RawVideo = {
    ...ranked[0].video,
    variants: ranked.map(({ video }) => video),
    ...(partner ? { audioUrl: partner.url } : {}),
  };

  return {
    videos: [primary, ...allVideos.filter((video) => !silent.includes(video))],
    audio: partner ? allAudio.filter((track) => track !== partner) : allAudio,
  };
}

async function mediaVariants(
  recommendedUrl: string,
  candidates: MediaCandidate[] | undefined,
  fallbackType: string,
): Promise<MediaVariant[]> {
  const ordered = [
    ...(candidates ?? [{ url: recommendedUrl, isStreaming: false }]),
  ].sort((a, b) => variantScore(b) - variantScore(a));

  const sizes = await mapWithConcurrency(ordered, 6, (candidate, index) =>
    candidate.isStreaming || index >= MAX_VARIANT_SIZE_LOOKUPS
      ? Promise.resolve(null)
      : headSafely(candidate.url),
  );

  return ordered.map((candidate, index) => {
    const fileType = candidate.isStreaming
      ? "HLS"
      : fileTypeFromUrl(candidate.url, fallbackType);
    return {
      url: candidate.url,
      name: candidate.isStreaming
        ? nameFromUrl(candidate.url)
        : ensureFileExtension(nameFromUrl(candidate.url), fileType),
      fileType,
      quality: candidate.quality,
      size: formatBytes(sizes[index]?.contentLength ?? null),
      sizeBytes: sizes[index]?.contentLength ?? null,
      wasStreaming: candidate.isStreaming,
      recommended: candidate.url === recommendedUrl,
    };
  });
}

function familyFromFontFileName(url: string): string {
  const base = nameFromUrl(url).replace(/\.[a-z0-9]+$/i, "");
  return base.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
];

function sortWeights(weights: string[]): string[] {
  return [...weights].sort(
    (a, b) =>
      WEIGHT_ORDER.indexOf(a.toLowerCase()) -
      WEIGHT_ORDER.indexOf(b.toLowerCase()),
  );
}

function ndjson(event: ScanStreamEvent): string {
  return JSON.stringify(event) + "\n";
}

// Every response is an NDJSON stream, even validation failures, so the
// client only ever has one code path instead of branching on response shape.
function ndjsonErrorResponse(error: ScanError): Response {
  const body = ndjson({ type: "error", error }) + ndjson({ type: "done" });
  return new Response(body, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8" },
  });
}

async function runScan(pageUrl: URL, send: (event: ScanStreamEvent) => void) {
  const pageUrlString = pageUrl.toString();

  let html: string;
  try {
    const res = await fetchWithTimeout(pageUrlString, {
      timeoutMs: 10000,
      headers: { accept: "text/html,application/xhtml+xml" },
    });

    if (
      res.status === 401 ||
      res.status === 403 ||
      res.status === 451 ||
      res.status === 429
    ) {
      send({
        type: "error",
        error: {
          kind: "blocked",
          message: `The page responded with ${res.status} — it may require a login, sit behind a paywall, or be blocking automated scans.`,
        },
      });
      send({ type: "done" });
      return;
    }

    if (!res.ok) {
      send({
        type: "error",
        error: {
          kind: "broken",
          message: `The page responded with ${res.status}.`,
        },
      });
      send({ type: "done" });
      return;
    }

    html = await res.text();
  } catch {
    send({
      type: "error",
      error: { kind: "broken", message: "We couldn't reach that page." },
    });
    send({ type: "done" });
    return;
  }

  const $ = cheerio.load(html);
  const title = extractTitle($) || pageUrl.hostname;
  const scanDate = new Date().toISOString().slice(0, 10);

  send({
    type: "meta",
    pageUrl: pageUrlString,
    pageTitle: title,
    sourceDomain: pageUrl.hostname,
    scanDate,
  });

  const credit: CreditInfo = {
    sourceDomain: pageUrl.hostname,
    pageTitle: title,
    originalUrl: pageUrlString,
    scanDate,
  };

  // --- video / audio / 3d models — kicked off first since the headless
  // browser pass is the slow part; everything below runs concurrently with it
  const seenVideoUrls = new Set<string>();
  const seenAudioUrls = new Set<string>();
  const seenModelUrls = new Set<string>();
  let videoIndex = 0;
  let audioIndex = 0;
  let modelIndex = 0;
  let streamingDrmChecks = 0;
  const pendingMedia: Promise<void>[] = [];

  async function emitVideo(raw: RawVideo) {
    if (
      seenVideoUrls.has(raw.url) ||
      seenVideoUrls.size >= MAX_MEDIA_ASSETS_PER_KIND
    )
      return;
    seenVideoUrls.add(raw.url);
    const index = videoIndex++;

    let drm = false;
    let meta: Awaited<ReturnType<typeof headSafely>> = null;
    if (raw.isStreaming) {
      if (streamingDrmChecks < 6) {
        streamingDrmChecks++;
        const text = await fetchTextSafely(raw.url, {
          timeoutMs: 5000,
          maxBytes: 50_000,
        });
        drm = text ? /#EXT-X-KEY[^\n]*METHOD=(?!NONE)/i.test(text) : false;
      }
    } else {
      meta = await headSafely(raw.url);
    }

    // og:video and canonical tags point at watch pages, not files. Without this
    // a YouTube scan lists "aqz-KE-bpKQ.html" as a 0-byte video.
    if (!raw.isStreaming && meta?.contentType?.includes("text/html")) return;

    // Extract file type from URL extension first, then Content-Type if no extension
    const urlExtension = fileTypeFromUrl(raw.url, "");
    const fileType = raw.isStreaming
      ? "HLS"
      : urlExtension || fileTypeFromContentType(meta?.contentType) || "MP4";

    const audioMeta = raw.audioUrl ? await headSafely(raw.audioUrl) : null;

    const asset: VideoAsset = {
      id: `video-${index}`,
      category: "video",
      name: raw.isStreaming
        ? nameFromUrl(raw.url)
        : ensureFileExtension(nameFromUrl(raw.url), fileType),
      url: raw.url,
      wasStreaming: raw.isStreaming,
      drmProtected: raw.isStreaming ? drm : undefined,
      fileType,
      size: raw.isStreaming ? "—" : formatBytes(meta?.contentLength ?? null),
      sizeBytes: raw.isStreaming ? null : meta?.contentLength ?? null,
      variants: await mediaVariants(raw.url, raw.variants, "MP4"),
      ...(raw.audioUrl
        ? {
            audioUrl: raw.audioUrl,
            audioName: ensureFileExtension(nameFromUrl(raw.audioUrl), "M4A"),
            audioSizeBytes: audioMeta?.contentLength ?? null,
          }
        : {}),
      credit,
    };
    send({ type: "asset", asset });
  }

  async function emitAudio(raw: RawAudio) {
    if (
      seenAudioUrls.has(raw.url) ||
      seenAudioUrls.size >= MAX_MEDIA_ASSETS_PER_KIND
    )
      return;
    seenAudioUrls.add(raw.url);
    const index = audioIndex++;

    let drm = false;
    const meta = raw.isStreaming ? null : await headSafely(raw.url);
    if (raw.isStreaming && streamingDrmChecks < 6) {
      streamingDrmChecks++;
      const text = await fetchTextSafely(raw.url, {
        timeoutMs: 5000,
        maxBytes: 50_000,
      });
      drm = text ? /#EXT-X-KEY[^\n]*METHOD=(?!NONE)/i.test(text) : false;
    }

    if (!raw.isStreaming && meta?.contentType?.includes("text/html")) return;

    // Extract file type from URL extension first, then Content-Type if no extension
    const urlExtension = fileTypeFromUrl(raw.url, "");
    const fileType = raw.isStreaming
      ? "HLS"
      : urlExtension || fileTypeFromContentType(meta?.contentType) || "MP3";

    const asset: AudioAsset = {
      id: `audio-${index}`,
      category: "audio",
      name: raw.isStreaming
        ? nameFromUrl(raw.url)
        : ensureFileExtension(nameFromUrl(raw.url), fileType),
      url: raw.url,
      fileType,
      size: raw.isStreaming ? "—" : formatBytes(meta?.contentLength ?? null),
      sizeBytes: raw.isStreaming ? null : meta?.contentLength ?? null,
      wasStreaming: raw.isStreaming,
      drmProtected: raw.isStreaming ? drm : undefined,
      variants: await mediaVariants(raw.url, raw.variants, "MP3"),
      credit,
    };
    send({ type: "asset", asset });
  }

  async function emitModel(raw: RawModel3D) {
    if (
      seenModelUrls.has(raw.url) ||
      seenModelUrls.size >= MAX_MEDIA_ASSETS_PER_KIND
    )
      return;
    seenModelUrls.add(raw.url);
    const index = modelIndex++;

    const meta = await headSafely(raw.url);

    // Extract file type from URL extension first, then Content-Type if no extension
    const urlExtension = fileTypeFromUrl(raw.url, "");
    const fileType =
      urlExtension || fileTypeFromContentType(meta?.contentType) || "GLB";

    const asset: Model3DAsset = {
      id: `model3d-${index}`,
      category: "model3d",
      name: ensureFileExtension(nameFromUrl(raw.url), fileType),
      url: raw.url,
      fileType,
      size: formatBytes(meta?.contentLength ?? null),
      sizeBytes: meta?.contentLength ?? null,
      credit,
    };
    send({ type: "asset", asset });
  }

  // Buffered rather than emitted immediately: adaptive-stream CDNs surface many
  // URLs (qualities, playlists, direct file) per real video/audio track, so
  // they need to be seen in full and grouped before
  // going out.
  const networkVideoCandidates: RawVideo[] = [];
  const networkAudioCandidates: MediaCandidate[] = [];

  function onNetworkMedia(media: RawNetworkMedia) {
    if (media.kind === "video") {
      networkVideoCandidates.push({
        url: media.url,
        isStreaming: media.isStreaming,
      });
      return;
    }
    if (media.kind === "audio") {
      networkAudioCandidates.push({
        url: media.url,
        isStreaming: media.isStreaming,
      });
      return;
    }
    pendingMedia.push(emitModel({ url: media.url }));
  }

  const networkMediaDone = captureNetworkMedia(
    pageUrlString,
    onNetworkMedia,
    (message) =>
      send({ type: "notice", scope: "network-capture", message }),
  );

  // Iframe players (VideoPress, Vimeo) expose their renditions through a
  // provider API, so they arrive pre-grouped — kept out of the network
  // candidate buffer below to preserve that grouping.
  const iframeUrls = extractIframeUrls($, pageUrlString);
  const embedVideosDone = resolveEmbedVideos(iframeUrls, html)
  const youtubeDone = resolveYouTubeEmbeds(iframeUrls, html)

  // Static extraction can find the same adaptive-stream variants the network
  // capture does (e.g. player config JSON inlined in the page), so these feed
  // the same buffer/dedup pass rather than being emitted immediately.
  networkVideoCandidates.push(...extractVideos($, html, pageUrlString));
  networkAudioCandidates.push(...extractAudio($, html, pageUrlString));
  for (const model of extractModels($, html, pageUrlString))
    pendingMedia.push(emitModel(model));

  // --- images + logo candidate ---------------------------------------------
  // YouTube's own media is unreachable by design (POST /videoplayback carrying
  // application/vnd.yt-ump), so the poster frame is the one real asset a
  // YouTube embed can contribute. Awaited here so it rides along with the rest
  // of the images instead of arriving after the category closes.
  const youtubeEmbeds = await youtubeDone;
  if (youtubeEmbeds.length > 0) {
    send({
      type: "notice",
      scope: "youtube",
      message: `Found ${youtubeEmbeds.length} YouTube video${
        youtubeEmbeds.length === 1 ? "" : "s"
      }. YouTube serves its video over a protocol that can't be captured from a URL, so only the poster frames and titles are available.`,
    });
  }

  const ogImage = extractOgImage($, pageUrlString);
  const scannedImages = extractImages($, pageUrlString);
  // og:image is often hosted elsewhere and never appears as an <img> tag, so
  // it's merged in explicitly, prepended so it survives the later 24-image cap.
  const youtubeThumbnails = youtubeEmbeds.map((embed) => ({
    url: embed.thumbnailUrl,
    alt: embed.title,
    looksLikeLogo: false,
  }));

  const rawImages = (() => {
    const merged = [
      ...youtubeThumbnails,
      ...(ogImage ? [ogImage] : []),
      ...scannedImages,
    ];
    // A YouTube watch page sets og:image to the same poster frame the embed
    // resolver returns, so the list needs one dedup pass rather than the
    // single ogImage check it used to do.
    const seen = new Set<string>();
    return merged.filter((img) =>
      seen.has(img.url) ? false : (seen.add(img.url), true),
    );
  })();
  const rawIcons = extractIcons($, pageUrlString);

  const logoCandidate =
    rawImages.find((img) => img.looksLikeLogo) ??
    (() => {
      const appleIcon = rawIcons.find((icon) => /apple-touch-icon/i.test(icon));
      return appleIcon
        ? { url: appleIcon, alt: "", looksLikeLogo: true }
        : null;
    })();

  const imagesWithoutLogo = rawImages.filter(
    (img) => img.url !== logoCandidate?.url,
  );
  const boundedImages = imagesWithoutLogo.slice(0, 24);

  const [imageMeta, logoMeta] = await Promise.all([
    mapWithConcurrency(boundedImages, 6, (img) => headSafely(img.url)),
    logoCandidate ? headSafely(logoCandidate.url) : Promise.resolve(null),
  ]);

  const imageAssets: ImageAsset[] = boundedImages.map((img, index) => {
    const fileType = fileTypeFromUrl(
      img.url,
      imageMeta[index]?.contentType?.split("/")[1]?.toUpperCase() ?? "IMG",
    );
    return {
      id: `image-${index}`,
      category: "images",
      name: ensureFileExtension(nameFromUrl(img.url), fileType),
      url: img.url,
      fileType,
      size: formatBytes(imageMeta[index]?.contentLength ?? null),
      sizeBytes: imageMeta[index]?.contentLength ?? null,
      credit,
    };
  });

  const logoAssets: LogoAsset[] = logoCandidate
    ? [
        (() => {
          const fileType = fileTypeFromUrl(
            logoCandidate.url,
            logoMeta?.contentType?.split("/")[1]?.toUpperCase() ?? "IMG",
          );
          return {
            id: "logo-0",
            category: "logo" as const,
            name: ensureFileExtension(nameFromUrl(logoCandidate.url), fileType),
            url: logoCandidate.url,
            fileType,
            size: formatBytes(logoMeta?.contentLength ?? null),
            sizeBytes: logoMeta?.contentLength ?? null,
            confidence: "likely" as const,
            credit,
          };
        })(),
      ]
    : [];

  send({ type: "category", category: "logo", assets: logoAssets });
  send({ type: "category-done", category: "logo" });
  send({ type: "category", category: "images", assets: imageAssets });
  send({ type: "category-done", category: "images" });

  // --- fonts + colors from stylesheets ------------------------------------
  const stylesheetUrls = extractStylesheetUrls($, pageUrlString);
  const inlineCss = extractInlineStyleText($);
  const preloadFontUrls = extractPreloadFonts($, pageUrlString);

  const stylesheetTexts = await mapWithConcurrency(stylesheetUrls, 4, (url) =>
    fetchTextSafely(url, { timeoutMs: 6000, maxBytes: 400_000 }),
  );

  const rawFontsFromCss: RawFont[] = stylesheetUrls.flatMap((url, index) => {
    const text = stylesheetTexts[index];
    return text ? parseFontFaces(text, url) : [];
  });

  const rawFontsFromPreload: RawFont[] = preloadFontUrls.map((url) => ({
    fontFamily: familyFromFontFileName(url),
    weight: "—",
    url,
    coversLatin: true,
  }));

  // A family usually resolves to many files (one per subset, weight and
  // format) but the card offers a single download, so pick the one a person
  // actually wants: readable Latin text, in the format browsers prefer, at
  // regular weight.
  function fontPickScore(font: RawFont): number {
    let score = 0;
    if (font.coversLatin) score += 4;
    if (/\.woff2(?:[?#]|$)/i.test(font.url)) score += 2;
    if (/^(?:400|normal)$/i.test(font.weight)) score += 1;
    return score;
  }

  const fontsByFamily = new Map<
    string,
    { url: string; score: number; weights: Set<string> }
  >();
  for (const font of [...rawFontsFromCss, ...rawFontsFromPreload]) {
    const existing = fontsByFamily.get(font.fontFamily);
    const score = fontPickScore(font);
    if (existing) {
      existing.weights.add(font.weight);
      if (score > existing.score) {
        existing.url = font.url;
        existing.score = score;
      }
    } else {
      fontsByFamily.set(font.fontFamily, {
        url: font.url,
        score,
        weights: new Set([font.weight]),
      });
    }
  }

  const fontEntries = [...fontsByFamily.entries()].slice(0, 12);
  const fontMeta = await mapWithConcurrency(fontEntries, 6, ([, info]) =>
    headSafely(info.url),
  );

  const fontAssets: FontAsset[] = fontEntries.map(
    ([fontFamily, info], index) => ({
      id: `font-${index}`,
      category: "fonts",
      name: nameFromUrl(info.url),
      url: info.url,
      fontFamily,
      weights: sortWeights([...info.weights]),
      fileType: fileTypeFromUrl(info.url, "FONT"),
      size: formatBytes(fontMeta[index]?.contentLength ?? null),
      sizeBytes: fontMeta[index]?.contentLength ?? null,
      credit,
    }),
  );

  send({ type: "category", category: "fonts", assets: fontAssets });
  send({ type: "category-done", category: "fonts" });

  const allCss = [
    inlineCss,
    ...stylesheetTexts.filter((t): t is string => Boolean(t)),
  ].join("\n");
  const colorAssets: ColorAsset[] = parseColors(allCss).map((hex, index) => ({
    id: `color-${index}`,
    category: "colors",
    name: hex.toUpperCase(),
    hex,
    fileType: "HEX",
    size: "—",
    credit,
  }));

  send({ type: "category", category: "colors", assets: colorAssets });
  send({ type: "category-done", category: "colors" });

  // Keep every network rendition under one card and recommend the strongest
  // downloadable candidate instead of showing a wall of duplicates.
  const [, embedVideos] = await Promise.all([
    networkMediaDone,
    embedVideosDone,
  ]);

  // The network pass sees the same renditions from inside the iframe — both
  // the video ladder and the audio track the adaptive stream splits out. Drop
  // both so an embed stays one card instead of doubling up with a regrouped
  // copy of its own variants plus a phantom audio asset.
  const embedGroupKeys = new Set(
    embedVideos.flatMap((video) =>
      [video, ...(video.variants ?? [])].map((variant) =>
        mediaGroupKey(variant.url),
      ),
    ),
  );
  for (const video of embedVideos) pendingMedia.push(emitVideo(video));

  const unclaimedVideos = networkVideoCandidates.filter(
    (candidate) => !embedGroupKeys.has(mediaGroupKey(candidate.url)),
  );
  const unclaimedAudio = networkAudioCandidates.filter(
    (candidate) => !embedGroupKeys.has(mediaGroupKey(candidate.url)),
  );

  // Filenames alone can't tell picture from sound on every CDN, so settle it
  // against the actual files before anything is emitted.
  const reconciled = await reconcileTracks(
    groupMediaCandidates(unclaimedVideos),
    groupMediaCandidates(unclaimedAudio),
  );

  for (const video of reconciled.videos) pendingMedia.push(emitVideo(video));
  for (const audio of reconciled.audio) pendingMedia.push(emitAudio(audio));
  await Promise.all(pendingMedia);

  send({ type: "category-done", category: "video" });
  send({ type: "category-done", category: "audio" });
  send({ type: "category-done", category: "model3d" });

  send({ type: "done" });
}

export async function POST(request: Request) {
  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return ndjsonErrorResponse({
      kind: "invalid",
      message: "Bad request body",
    });
  }

  const raw = body.url?.trim();
  if (!raw) {
    return ndjsonErrorResponse({ kind: "invalid", message: "Missing url" });
  }

  let pageUrl: URL;
  try {
    pageUrl = assertSafePublicUrl(raw);
  } catch (error) {
    if (error instanceof UnsafeUrlError) {
      return ndjsonErrorResponse({ kind: "invalid", message: error.message });
    }
    throw error;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ScanStreamEvent) =>
        controller.enqueue(encoder.encode(ndjson(event)));
      try {
        await runScan(pageUrl, send);
      } catch {
        send({
          type: "error",
          error: {
            kind: "broken",
            message: "Something went wrong while scanning.",
          },
        });
        send({ type: "done" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache",
    },
  });
}
