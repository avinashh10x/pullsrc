import * as cheerio from "cheerio";

import { resolveUrl } from "./http";

export interface RawImage {
  url: string;
  alt: string;
  looksLikeLogo: boolean;
}

export interface RawFont {
  fontFamily: string;
  weight: string;
  url: string;
}

export interface RawVideo {
  url: string;
  isStreaming: boolean;
  variants?: RawVideo[];
}

export interface RawAudio {
  url: string;
  isStreaming: boolean;
  variants?: RawAudio[];
}

export interface RawModel3D {
  url: string;
}

const PLACEHOLDER_SRC =
  /^data:|blank\.gif|placeholder|lazy(load)?\.(png|gif|svg)/i;
const LOGO_HINT = /logo|brand-mark|site-icon/i;

function firstUsableSrc($img: ReturnType<cheerio.CheerioAPI>): string | null {
  const candidates = [
    $img.attr("src"),
    $img.attr("data-src"),
    $img.attr("data-lazy-src"),
    $img.attr("data-original"),
  ];
  for (const candidate of candidates) {
    if (candidate && !PLACEHOLDER_SRC.test(candidate)) return candidate;
  }
  return null;
}

export function extractTitle($: cheerio.CheerioAPI): string {
  const title = $("title").first().text().trim();
  if (title) return title;
  const ogTitle = $('meta[property="og:title"]').attr("content");
  return ogTitle?.trim() || "";
}

export function extractImages(
  $: cheerio.CheerioAPI,
  pageUrl: string,
): RawImage[] {
  const seen = new Set<string>();
  const images: RawImage[] = [];

  $("img").each((_, el) => {
    const $img = $(el);
    const src = firstUsableSrc($img);
    if (!src) return;
    const absolute = resolveUrl(src, pageUrl);
    if (!absolute || seen.has(absolute)) return;
    seen.add(absolute);

    const alt = $img.attr("alt") ?? "";
    const className = $img.attr("class") ?? "";
    const id = $img.attr("id") ?? "";
    const looksLikeLogo =
      LOGO_HINT.test(absolute) ||
      LOGO_HINT.test(alt) ||
      LOGO_HINT.test(className) ||
      LOGO_HINT.test(id) ||
      Boolean($img.closest('[class*="logo" i], [id*="logo" i]').length);

    images.push({ url: absolute, alt, looksLikeLogo });
    if (images.length >= 60) return false;
  });

  return images;
}

// The social-share preview image — often just a meta tag pointing at an
// asset hosted elsewhere, not an <img> tag, so it needs its own extraction.
export function extractOgImage(
  $: cheerio.CheerioAPI,
  pageUrl: string,
): RawImage | null {
  const content =
    $('meta[property="og:image:secure_url"]').attr("content") ??
    $('meta[property="og:image:url"]').attr("content") ??
    $('meta[property="og:image"]').attr("content") ??
    $('meta[name="twitter:image"]').attr("content") ??
    $('meta[name="twitter:image:src"]').attr("content");
  if (!content) return null;

  const absolute = resolveUrl(content, pageUrl);
  if (!absolute) return null;

  const alt =
    $('meta[property="og:image:alt"]').attr("content") ??
    $('meta[name="twitter:image:alt"]').attr("content") ??
    "";

  return { url: absolute, alt, looksLikeLogo: false };
}

export function extractIcons($: cheerio.CheerioAPI, pageUrl: string): string[] {
  const seen = new Set<string>();
  const icons: string[] = [];

  $(
    'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"], link[rel="mask-icon"]',
  ).each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const absolute = resolveUrl(href, pageUrl);
    if (!absolute || seen.has(absolute)) return;
    seen.add(absolute);
    icons.push(absolute);
  });

  return icons;
}

export function extractStylesheetUrls(
  $: cheerio.CheerioAPI,
  pageUrl: string,
): string[] {
  const seen = new Set<string>();
  const sheets: string[] = [];

  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const absolute = resolveUrl(href, pageUrl);
    if (!absolute || seen.has(absolute)) return;
    seen.add(absolute);
    sheets.push(absolute);
  });

  sheets.sort(
    (a, b) => Number(b.includes("font")) - Number(a.includes("font")),
  );
  return sheets.slice(0, 6);
}

export function extractInlineStyleText($: cheerio.CheerioAPI): string {
  return $("style")
    .map((_, el) => $(el).text())
    .get()
    .join("\n");
}

export function extractPreloadFonts(
  $: cheerio.CheerioAPI,
  pageUrl: string,
): string[] {
  const seen = new Set<string>();
  const fonts: string[] = [];

  $(
    'link[as="font"], link[rel="preload"][href$=".woff2"], link[rel="preload"][href$=".woff"]',
  ).each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const absolute = resolveUrl(href, pageUrl);
    if (!absolute || seen.has(absolute)) return;
    seen.add(absolute);
    fonts.push(absolute);
  });

  return fonts;
}

export function parseFontFaces(cssText: string, cssBaseUrl: string): RawFont[] {
  const fonts: RawFont[] = [];
  const blockPattern = /@font-face\s*{([^}]*)}/gi;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockPattern.exec(cssText))) {
    const block = blockMatch[1];

    const familyMatch =
      /font-family\s*:\s*(?:"([^"]+)"|'([^']+)'|([^;]+))/i.exec(block);
    const fontFamily = (
      familyMatch?.[1] ??
      familyMatch?.[2] ??
      familyMatch?.[3] ??
      ""
    ).trim();
    if (!fontFamily) continue;

    const weightMatch = /font-weight\s*:\s*([^;]+)/i.exec(block);
    const weight = weightMatch?.[1]?.trim() ?? "400";

    const urlMatches = [
      ...block.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^)]+))\s*\)/gi),
    ];
    if (urlMatches.length === 0) continue;

    const preferred =
      urlMatches.find((m) => /\.woff2/i.test(m[0])) ?? urlMatches[0];
    const rawUrl = (preferred[1] ?? preferred[2] ?? preferred[3] ?? "").trim();
    const absolute = resolveUrl(rawUrl, cssBaseUrl);
    if (!absolute) continue;

    fonts.push({ fontFamily, weight, url: absolute });
  }

  return fonts;
}

const HEX_COLOR = /#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi;
const RGB_COLOR =
  /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)/gi;

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export function parseColors(cssText: string): string[] {
  const counts = new Map<string, number>();

  for (const match of cssText.matchAll(HEX_COLOR)) {
    let hex = match[0].toLowerCase();
    if (hex.length === 4) {
      hex = `#${[...hex.slice(1)].map((c) => c + c).join("")}`;
    }
    if (hex.length === 9) hex = hex.slice(0, 7);
    if (hex.length === 5) hex = hex.slice(0, 4);
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }

  for (const match of cssText.matchAll(RGB_COLOR)) {
    const hex = rgbToHex(Number(match[1]), Number(match[2]), Number(match[3]));
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([hex]) => hex);
}

const VIDEO_FILE_PATTERN =
  /(?:(?:https?:)?\/\/|\/|\.\.\/)[^\s"'<>\\]+?\.(?:mp4|webm|mov|m4v|ogv|avi|mkv|3gp|mts|m2ts|asf|wmv|flv|f4v|hevc|vob|m2v|mxf|vp8|vp9)(?:\?[^\s"'<>\\]*)?/gi;
const MANIFEST_PATTERN =
  /(?:(?:https?:)?\/\/|\/|\.\.?\/)[^\s"'<>\\]+?\.(?:m3u8|mpd)(?:\?[^\s"'<>\\]*)?/gi;
const AUDIO_MANIFEST_HINT =
  /(?:[._-]audio|audio[._-]|\/audio\/).*(?:m3u8|mpd)(?:\?|#|$)/i;

function mediaAttributeSources(
  $: cheerio.CheerioAPI,
  selector: string,
  pageUrl: string,
): string[] {
  const found = new Set<string>();
  $(selector).each((_, el) => {
    const $el = $(el);
    for (const attribute of [
      "src",
      "href",
      "data-src",
      "data-lazy-src",
      "data-url",
      "data-file",
      "data-asset-url",
      "data-model",
      "data-model-url",
    ]) {
      const value = $el.attr(attribute);
      if (!value) continue;
      const absolute = resolveUrl(value, pageUrl);
      if (absolute) found.add(absolute);
    }
  });
  return [...found];
}

export function extractVideos(
  $: cheerio.CheerioAPI,
  html: string,
  pageUrl: string,
): RawVideo[] {
  const seen = new Set<string>();
  const videos: RawVideo[] = [];

  function add(rawUrl: string, isStreaming: boolean) {
    const absolute = resolveUrl(rawUrl, pageUrl);
    if (!absolute || seen.has(absolute)) return;
    seen.add(absolute);
    videos.push({ url: absolute, isStreaming });
  }

  for (const src of mediaAttributeSources(
    $,
    "video, video source, link[as='video']",
    pageUrl,
  ))
    add(src, false);

  const ogVideo =
    $('meta[property="og:video:secure_url"]').attr("content") ??
    $('meta[property="og:video:url"]').attr("content") ??
    $('meta[property="og:video"]').attr("content");
  if (ogVideo) add(ogVideo, false);

  for (const match of html.replaceAll("\\/", "/").matchAll(MANIFEST_PATTERN)) {
    if (!AUDIO_MANIFEST_HINT.test(match[0])) add(match[0], true);
  }

  for (const match of html
    .replaceAll("\\/", "/")
    .matchAll(VIDEO_FILE_PATTERN)) {
    add(match[0], false);
  }

  return videos;
}

const AUDIO_FILE_PATTERN =
  /(?:(?:https?:)?\/\/|\/|\.\.\/)[^\s"'<>\\]+?\.(?:mp3|wav|ogg|m4a|flac|aac|weba|opus|aiff|alac|wma|m4b|dsd|ape)(?:\?[^\s"'<>\\]*)?/gi;

export function extractAudio(
  $: cheerio.CheerioAPI,
  html: string,
  pageUrl: string,
): RawAudio[] {
  const seen = new Set<string>();
  const audio: RawAudio[] = [];

  function add(rawUrl: string, isStreaming = false) {
    const absolute = resolveUrl(rawUrl, pageUrl);
    if (!absolute || seen.has(absolute)) return;
    seen.add(absolute);
    audio.push({ url: absolute, isStreaming });
  }

  for (const src of mediaAttributeSources(
    $,
    "audio, audio source, link[as='audio']",
    pageUrl,
  ))
    add(src);

  const ogAudio =
    $('meta[property="og:audio:secure_url"]').attr("content") ??
    $('meta[property="og:audio:url"]').attr("content") ??
    $('meta[property="og:audio"]').attr("content");
  if (ogAudio) add(ogAudio);

  for (const match of html.replaceAll("\\/", "/").matchAll(MANIFEST_PATTERN)) {
    if (AUDIO_MANIFEST_HINT.test(match[0])) add(match[0], true);
  }

  for (const match of html
    .replaceAll("\\/", "/")
    .matchAll(AUDIO_FILE_PATTERN)) {
    add(match[0]);
  }

  return audio;
}

const MODEL_FILE_PATTERN =
  /(?:(?:https?:)?\/\/|\/|\.\.?\/)[^\s"'<>\\]+?\.(?:glb|gltf|usdz|obj|fbx|dae|stl|ply|3mf|vrm|x3d|wrl|splat|blend|iges|step|stp)(?:\?[^\s"'<>\\]*)?/gi;

export function extractModels(
  $: cheerio.CheerioAPI,
  html: string,
  pageUrl: string,
): RawModel3D[] {
  const seen = new Set<string>();
  const models: RawModel3D[] = [];

  function add(rawUrl: string) {
    const absolute = resolveUrl(rawUrl, pageUrl);
    if (!absolute || seen.has(absolute)) return;
    seen.add(absolute);
    models.push({ url: absolute });
  }

  // <model-viewer> is the standard custom element for embedding 3D models.
  // Preloaded files and asset links are common in Three.js/Babylon pages too.
  $("model-viewer[src], model-viewer[ios-src]").each((_, el) => {
    const $el = $(el);
    const src = $el.attr("src") ?? $el.attr("ios-src");
    if (src) add(src);
  });

  for (const src of mediaAttributeSources(
    $,
    "link[as='model'], [data-model], [data-model-url]",
    pageUrl,
  ))
    add(src);

  for (const match of html
    .replaceAll("\\/", "/")
    .matchAll(MODEL_FILE_PATTERN)) {
    add(match[0]);
  }

  return models;
}
