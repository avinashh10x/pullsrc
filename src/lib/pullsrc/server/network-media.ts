import type { Page } from "playwright";

export interface RawNetworkMedia {
  url: string;
  kind: "video" | "audio" | "model3d";
  isStreaming: boolean;
}

const VIDEO_EXT =
  /\.(mp4|webm|mov|m4v|ogv|avi|mkv|3gp|mts|m2ts|asf|wmv|flv|f4v|hevc|vob|m2v|mxf|vp8|vp9)(?:\?|#|$)/i;
const AUDIO_EXT =
  /\.(mp3|wav|ogg|m4a|flac|aac|weba|opus|aiff|alac|wma|m4b|dsd|ape)(?:\?|#|$)/i;
const MODEL_EXT =
  /\.(glb|gltf|usdz|obj|fbx|dae|stl|ply|3mf|vrm|x3d|wrl|splat|blend|iges|step|stp)(?:\?|#|$)/i;
const IMAGE_EXT =
  /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|tiff|heif|heic|avif|evif)(?:\?|#|$)/i;
const MANIFEST_EXT = /\.(m3u8|mpd)(?:\?|#|$)/i;
// HLS/DASH segment/fragment files — chunks of a stream, not standalone videos
const SEGMENT_EXT = /\.(ts|m4s)(?:\?|#|$)/i;
// Adaptive-stream renditions split the audio track into its own file/manifest
// (e.g. foo_dvd.audio.m3u8) — that's audio, not a video, even though it sits
// right next to the real video variants under the same content-type/manifest rules.
const AUDIO_ONLY_HINT =
  /(?:[._-]audio|audio[._-]|\/audio\/).*(?:m3u8|mpd|mp4|m4a|aac|opus)(?:\?|#|$)/i;

function classify(
  url: string,
  contentType: string,
): { kind: RawNetworkMedia["kind"]; isStreaming: boolean } | null {
  if (SEGMENT_EXT.test(url)) return null;

  // CRITICAL: Reject image files even if server claims they're video/audio
  // This prevents .evif and other images from appearing in wrong tabs
  if (IMAGE_EXT.test(url)) return null;

  const isManifest =
    MANIFEST_EXT.test(url) || /mpegurl|dash\+xml/i.test(contentType);

  // Audio-only hint takes precedence
  if (AUDIO_ONLY_HINT.test(url))
    return { kind: "audio", isStreaming: isManifest };

  // Manifest (HLS/DASH) streaming
  if (isManifest) return { kind: "video", isStreaming: true };

  // PRIORITIZE FILE EXTENSION over content-type to prevent misclassification
  // Only use content-type as fallback if no extension recognized
  if (VIDEO_EXT.test(url)) return { kind: "video", isStreaming: false };
  if (AUDIO_EXT.test(url)) return { kind: "audio", isStreaming: false };
  if (MODEL_EXT.test(url)) return { kind: "model3d", isStreaming: false };

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

const USER_AGENT =
  "Mozilla/5.0 (compatible; PullSRCBot/1.0; +https://pullsrc.byavi.in) AppleWebKit/537.36";

// Checked first, used alone when present — reliable with no false positives.
const TAB_ROLE_SELECTOR = '[role="tab"]';

// Broader fallback for sites faking tabs without ARIA roles; only used when
// no [role="tab"] elements exist, since it can match unrelated UI.
const FALLBACK_TRIGGER_SELECTOR = [
  '[data-bs-toggle="tab"]',
  '[data-toggle="tab"]',
  '[aria-controls][aria-selected="false"]',
  '[aria-expanded="false"]',
].join(", ");

const MAX_TRIGGERS_TO_CLICK = 8;
const CLICK_SETTLE_MS = 900;

async function clickThroughRevealTriggers(page: Page) {
  page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));

  let handles: Awaited<ReturnType<Page["$$"]>>;
  try {
    handles = await page.$$(TAB_ROLE_SELECTOR);
    if (handles.length === 0) {
      handles = await page.$$(FALLBACK_TRIGGER_SELECTOR);
    }
  } catch {
    return;
  }

  for (const handle of handles.slice(0, MAX_TRIGGERS_TO_CLICK)) {
    try {
      if (!(await handle.isVisible())) continue;
      await handle.click({ timeout: 1000 });
      await page.waitForTimeout(CLICK_SETTLE_MS);
    } catch {
      // unclickable/detached — skip it
    }
  }
}

const MAX_SCROLL_STEPS = 10;
const SCROLL_SETTLE_MS = 400;

// Many sites (3D portfolios especially) mount content via an
// IntersectionObserver that only fires once scrolled into view.
async function scrollThroughPage(page: Page) {
  for (let step = 0; step < MAX_SCROLL_STEPS; step++) {
    const reachedBottom = await page
      .evaluate(() => {
        const before = window.scrollY;
        window.scrollBy(0, window.innerHeight * 0.9);
        return window.scrollY === before;
      })
      .catch(() => true);

    await page.waitForTimeout(SCROLL_SETTLE_MS);
    if (reachedBottom) break;
  }

  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(300);
}

async function activateMediaElements(page: Page) {
  await page
    .evaluate(() => {
      for (const element of document.querySelectorAll("video, audio")) {
        const media = element as HTMLMediaElement;
        media.muted = true;
        void media.play().catch(() => {});
      }
    })
    .catch(() => {});
  await page.waitForTimeout(800);
}

async function collectPerformanceMedia(
  page: Page,
  onMedia: (media: RawNetworkMedia) => void,
  seen: Set<string>,
) {
  const urls = await page
    .evaluate(() =>
      performance.getEntriesByType("resource").map((entry) => entry.name),
    )
    .catch(() => [] as string[]);
  for (const url of urls) {
    if (seen.has(url)) continue;
    const classified = classify(url, "");
    if (!classified) continue;
    seen.add(url);
    onMedia({ url, ...classified });
  }
}

// Loads the page in headless Chromium and watches network responses for
// video/audio/3D-model files that never show up as a static tag in the HTML.
// `onMedia` fires the instant each asset is detected, so callers streaming
// to a client shouldn't wait on the returned promise — it only resolves
// once the whole scroll + tab-click session finishes.
export async function captureNetworkMedia(
  pageUrl: string,
  onMedia: (media: RawNetworkMedia) => void,
  timeoutMs = 10000,
): Promise<void> {
  let chromiumModule: typeof import("playwright");
  try {
    chromiumModule = await import("playwright");
  } catch {
    console.warn("[pullsrc] playwright not installed — skipping network media capture");
    return;
  }

  const seen = new Set<string>();
  let browser: Awaited<
    ReturnType<typeof chromiumModule.chromium.launch>
  > | null = null;

  try {
    browser = await chromiumModule.chromium.launch({ args: ["--no-sandbox"] });
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1440, height: 1000 },
      locale: "en-US",
    });
    const page = await context.newPage();

    page.on("response", (response) => {
      const url = response.url();
      if (seen.has(url)) return;

      const contentType = response.headers()["content-type"] ?? "";
      const classified = classify(url, contentType);
      if (!classified) return;

      seen.add(url);
      onMedia({ url, ...classified });
    });

    // "load" not "networkidle" — an autoplaying/looping video keeps the
    // network busy forever, so an idle-based wait never resolves.
    await page
      .goto(pageUrl, { waitUntil: "load", timeout: timeoutMs })
      .catch(() => {});
    await page.waitForTimeout(1000);

    await activateMediaElements(page);
    await scrollThroughPage(page);
    await clickThroughRevealTriggers(page);
    await activateMediaElements(page);
    await collectPerformanceMedia(page, onMedia, seen);
  } catch (error) {
    // Best-effort — static extraction still runs regardless. Logged rather
    // than swallowed: a missing browser binary looks identical to "this page
    // has no media", which makes the whole pass silently useless.
    console.warn("[pullsrc] network media capture failed:", (error as Error).message);
  } finally {
    await browser?.close().catch(() => {});
  }
}
