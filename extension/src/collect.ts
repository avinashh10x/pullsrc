import type { PageSnapshot } from "./shared";

/**
 * Runs inside the inspected page via chrome.scripting.executeScript({ func }).
 *
 * Chrome serialises this with Function.prototype.toString and re-parses it in
 * the page, so it must be completely self-contained: no imports, no references
 * to anything in this module's scope. Nested helpers are fine; anything hoisted
 * out would be undefined at run time.
 */
export function collectSnapshot(): PageSnapshot {
  const IMAGE_RE = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|tiff|heif|heic|avif)(?:\?|#|$)/i;
  const FONT_RE = /\.(woff2|woff|ttf|otf|eot|ttc)(?:\?|#|$)/i;
  const MODEL_RE = /\.(glb|gltf|usdz|obj|fbx|dae|stl|ply|3mf|vrm|splat)(?:\?|#|$)/i;
  const MEDIA_RE = /\.(mp4|webm|mov|m4v|ogv|mkv|mp3|wav|ogg|m4a|flac|aac|opus|m3u8|mpd)(?:\?|#|$)/i;
  const LOGO_RE = /logo|brand-mark|site-icon|wordmark/i;
  const PLACEHOLDER_RE = /^data:image\/(?:gif|svg\+xml);base64,(?:R0lGOD|PHN2)|blank\.gif|1x1\.|spacer\.gif/i;

  const resources: PageSnapshot["resources"] = [];
  const seen = new Set<string>();

  function absolute(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
      return null;
    }
    try {
      const url = new URL(trimmed, document.baseURI);
      return url.protocol === "http:" || url.protocol === "https:"
        ? url.toString()
        : null;
    } catch {
      return null;
    }
  }

  function push(
    raw: string | null | undefined,
    origin: PageSnapshot["resources"][number]["origin"],
    alt?: string,
    looksLikeLogo?: boolean,
  ): void {
    const url = absolute(raw);
    if (!url || seen.has(url) || PLACEHOLDER_RE.test(url)) return;
    seen.add(url);
    resources.push({ url, origin, alt, looksLikeLogo });
  }

  // --- images -------------------------------------------------------------
  for (const img of Array.from(document.images)) {
    // currentSrc is what the browser actually chose from a srcset, which beats
    // guessing the best candidate the way HTML parsing has to.
    const chosen = img.currentSrc || img.src;
    const hinted =
      LOGO_RE.test(img.className || "") ||
      LOGO_RE.test(img.id || "") ||
      LOGO_RE.test(img.alt || "") ||
      LOGO_RE.test(chosen || "") ||
      Boolean(img.closest('header, [class*="logo" i], [class*="brand" i]'));
    push(chosen, "img", img.alt || undefined, hinted);
  }

  for (const source of Array.from(document.querySelectorAll("picture source"))) {
    const srcset = source.getAttribute("srcset") ?? "";
    for (const candidate of srcset.split(",")) {
      push(candidate.trim().split(/\s+/)[0], "srcset");
    }
  }

  for (const link of Array.from(
    document.querySelectorAll<HTMLLinkElement>(
      'link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="mask-icon"]',
    ),
  )) {
    push(link.href, "img", "icon", /apple-touch-icon/i.test(link.rel));
  }

  const ogImage = document.querySelector<HTMLMetaElement>(
    'meta[property="og:image"], meta[name="twitter:image"]',
  );
  if (ogImage) push(ogImage.content, "img", "social preview");

  // --- CSS background images ---------------------------------------------
  // Bounded: a large page has tens of thousands of nodes and every one costs a
  // style resolution.
  const styled = Array.from(document.querySelectorAll("*")).slice(0, 4000);
  const colorCounts = new Map<string, number>();

  function noteColor(value: string): void {
    const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(value);
    if (!match) return;
    // Fully transparent values are layout artefacts, not part of the palette.
    if (match[4] !== undefined && Number(match[4]) < 0.1) return;
    const hex =
      "#" +
      [match[1], match[2], match[3]]
        .map((n) => Number(n).toString(16).padStart(2, "0"))
        .join("");
    colorCounts.set(hex, (colorCounts.get(hex) ?? 0) + 1);
  }

  for (const element of styled) {
    const style = getComputedStyle(element);
    const background = style.backgroundImage;
    if (background && background !== "none") {
      for (const match of background.matchAll(/url\((['"]?)(.*?)\1\)/g)) {
        const url = match[2];
        push(url, MODEL_RE.test(url) ? "model" : "css");
      }
    }
    noteColor(style.color);
    noteColor(style.backgroundColor);
  }

  const colors = [...colorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([hex]) => hex);

  // --- media elements -----------------------------------------------------
  for (const media of Array.from(
    document.querySelectorAll<HTMLMediaElement>("video, audio"),
  )) {
    const kind = media.tagName === "VIDEO" ? "video" : "audio";
    push(media.currentSrc || media.getAttribute("src"), kind);
    for (const source of Array.from(media.querySelectorAll("source"))) {
      push(source.getAttribute("src"), kind);
    }
    if (media instanceof HTMLVideoElement) push(media.poster, "img", "poster");
  }

  for (const model of Array.from(
    document.querySelectorAll("model-viewer, a-asset-item, [src$='.glb'], [src$='.gltf']"),
  )) {
    push(model.getAttribute("src"), "model");
  }

  // --- everything the page actually loaded --------------------------------
  // The resource timeline catches fonts, sprites and lazily fetched media that
  // never appear as an attribute anywhere in the DOM.
  const fontUrls: string[] = [];
  for (const entry of performance.getEntriesByType("resource")) {
    const url = entry.name;
    if (FONT_RE.test(url)) {
      if (!fontUrls.includes(url)) fontUrls.push(url);
      continue;
    }
    if (IMAGE_RE.test(url) || MEDIA_RE.test(url) || MODEL_RE.test(url)) {
      push(url, "resource");
    }
  }

  // --- fonts --------------------------------------------------------------
  const weightsByFamily = new Map<string, Set<string>>();
  try {
    document.fonts.forEach((face) => {
      const family = face.family.replace(/^["']|["']$/g, "");
      if (!weightsByFamily.has(family)) weightsByFamily.set(family, new Set());
      weightsByFamily.get(family)!.add(face.weight);
    });
  } catch {
    // FontFaceSet iteration is unavailable in some embedded contexts.
  }

  function familyFor(url: string): string {
    const file = decodeURIComponent(url.split("/").pop() ?? "").replace(
      /\.[a-z0-9]+(?:\?.*)?$/i,
      "",
    );
    const stem = file.replace(/[-_]+/g, " ").trim();
    for (const family of weightsByFamily.keys()) {
      if (stem.toLowerCase().includes(family.toLowerCase().replace(/\s+/g, ""))) {
        return family;
      }
      if (stem.toLowerCase().startsWith(family.toLowerCase())) return family;
    }
    return stem.replace(/\b\w/g, (c) => c.toUpperCase()) || "Font";
  }

  const fonts = fontUrls.map((url) => {
    const family = familyFor(url);
    return {
      url,
      family,
      weights: [...(weightsByFamily.get(family) ?? new Set(["—"]))].sort(),
    };
  });

  return {
    pageUrl: location.href,
    pageTitle: document.title || location.hostname,
    resources,
    colors,
    fonts,
  };
}
