import type { Page } from "playwright";

export interface RawNetworkMedia {
  url: string;
  kind: "video" | "audio" | "model3d";
  isStreaming: boolean;
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)(?:\?|#|$)/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|flac|aac|weba)(?:\?|#|$)/i;
const MODEL_EXT = /\.(glb|gltf|usdz|obj|fbx)(?:\?|#|$)/i;
const MANIFEST_EXT = /\.(m3u8|mpd)(?:\?|#|$)/i;
// HLS/DASH segment/fragment files — chunks of a stream, not standalone videos
const SEGMENT_EXT = /\.(ts|m4s)(?:\?|#|$)/i;

function classify(
  url: string,
  contentType: string,
): { kind: RawNetworkMedia["kind"]; isStreaming: boolean } | null {
  if (SEGMENT_EXT.test(url)) return null;

  const isStreaming =
    MANIFEST_EXT.test(url) || /mpegurl|dash\+xml/i.test(contentType);
  if (isStreaming) return { kind: "video", isStreaming: true };

  if (VIDEO_EXT.test(url) || contentType.startsWith("video/"))
    return { kind: "video", isStreaming: false };
  if (AUDIO_EXT.test(url) || contentType.startsWith("audio/"))
    return { kind: "audio", isStreaming: false };
  if (MODEL_EXT.test(url) || /model\/(gltf|obj)/i.test(contentType))
    return { kind: "model3d", isStreaming: false };

  return null;
}

const USER_AGENT =
  "Mozilla/5.0 (compatible; PullSRCBot/1.0; +https://pullsrc.app) AppleWebKit/537.36";

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
    return;
  }

  const seen = new Set<string>();
  let browser: Awaited<
    ReturnType<typeof chromiumModule.chromium.launch>
  > | null = null;

  try {
    browser = await chromiumModule.chromium.launch({ args: ["--no-sandbox"] });
    const context = await browser.newContext({ userAgent: USER_AGENT });
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

    await scrollThroughPage(page);
    await clickThroughRevealTriggers(page);
  } catch {
    // best-effort — static extraction still runs regardless
  } finally {
    await browser?.close().catch(() => {});
  }
}
