import { existsSync } from "node:fs";
import path from "node:path";

import type { Browser, Page } from "playwright-core";

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

// Serverless hosts ship no browser: the `playwright` package downloads its
// Chromium into ~/.cache at install time, which never happens on Vercel, and
// a full Chromium wouldn't fit in the function bundle anyway. So production
// runs @sparticuz/chromium — a lambda-sized build — driven by playwright-core,
// while local dev keeps using the ordinary `playwright` browser.
const IS_SERVERLESS = Boolean(
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME,
);

// How much browser a serverless function can actually sustain depends on its
// memory limit, which this code can't see. Rather than hardcode a guess, try
// the configurations in order of usefulness and keep the first that survives
// opening a page — the crash shows up at newPage(), not at launch, so an
// attempt is only proven once a page exists.
//
// @sparticuz/chromium's flags are tuned for puppeteer, which renders
// in-process happily. Playwright prefers real renderer processes, but those
// cost memory, so dropping back to --single-process is the trade when the
// function is too small.
interface LaunchStrategy {
  label: string;
  webgl: boolean;
  singleProcess: boolean;
}

const SERVERLESS_STRATEGIES: LaunchStrategy[] = [
  { label: "multi-process+webgl", webgl: true, singleProcess: false },
  { label: "single-process+webgl", webgl: true, singleProcess: true },
  // Last resort: without WebGL, three.js never builds a scene and 3D models
  // stay invisible — but video, audio and client-rendered markup still come
  // through, which beats returning nothing.
  { label: "single-process+no-webgl", webgl: false, singleProcess: true },
];

const MULTI_PROCESS_ONLY_ARGS = new Set([
  "--single-process",
  "--no-zygote",
  "--in-process-gpu",
]);

// The package finds its own bin/ via import.meta.url, which Next muddies by
// symlinking externalised packages into .next/node_modules under a hashed
// name. Locate the archives ourselves and hand over an explicit path, so a
// packaging change can't silently turn into "this site has no media".
function resolveChromiumBinDir(): { dir: string | null; tried: string[] } {
  const candidates = [
    path.join(process.cwd(), "node_modules/@sparticuz/chromium/bin"),
    path.join(
      process.cwd(),
      ".next/server/node_modules/@sparticuz/chromium/bin",
    ),
    path.join(process.cwd(), ".next/node_modules/@sparticuz/chromium/bin"),
  ];

  for (const dir of candidates) {
    if (existsSync(path.join(dir, "chromium.br"))) return { dir, tried: candidates };
  }
  return { dir: null, tried: candidates };
}

interface BrowserSession {
  browser: Browser;
  page: Page;
  // Names the strategy that worked, plus anything that failed getting there.
  note: string | null;
}

const PAGE_OPTIONS = {
  userAgent: USER_AGENT,
  viewport: { width: 1440, height: 1000 },
  locale: "en-US",
} as const;

async function openServerlessSession(): Promise<BrowserSession> {
  const [{ chromium }, serverlessChromium] = await Promise.all([
    import("playwright-core"),
    import("@sparticuz/chromium").then((mod) => mod.default ?? mod),
  ]);

  const { dir, tried } = resolveChromiumBinDir();
  if (!dir) {
    throw new Error(
      `@sparticuz/chromium archives missing. cwd=${process.cwd()} tried=${tried.join(", ")}`,
    );
  }

  const failures: string[] = [];

  for (const strategy of SERVERLESS_STRATEGIES) {
    let browser: Browser | null = null;
    try {
      // three.js and friends only request their .glb once a WebGL context
      // comes up, so the software graphics stack decides whether 3D models
      // are visible at all. It also costs memory, hence the fallback.
      serverlessChromium.setGraphicsMode = strategy.webgl;

      const args = strategy.singleProcess
        ? serverlessChromium.args
        : serverlessChromium.args.filter(
            (arg) => !MULTI_PROCESS_ONLY_ARGS.has(arg),
          );

      browser = await chromium.launch({
        executablePath: await serverlessChromium.executablePath(dir),
        args,
        headless: true,
      });

      const context = await browser.newContext(PAGE_OPTIONS);
      const page = await context.newPage();

      return {
        browser,
        page,
        note: failures.length
          ? `using ${strategy.label} after: ${failures.join("; ")}`
          : null,
      };
    } catch (error) {
      failures.push(`${strategy.label} → ${(error as Error).message}`);
      await browser?.close().catch(() => {});
    }
  }

  throw new Error(`every launch strategy failed: ${failures.join("; ")}`);
}

async function openSession(): Promise<BrowserSession> {
  if (IS_SERVERLESS) return openServerlessSession();

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext(PAGE_OPTIONS);
  return { browser, page: await context.newPage(), note: null };
}

// Loads the page in headless Chromium and watches network responses for
// video/audio/3D-model files that never show up as a static tag in the HTML.
// `onMedia` fires the instant each asset is detected, so callers streaming
// to a client shouldn't wait on the returned promise — it only resolves
// once the whole scroll + tab-click session finishes.
export async function captureNetworkMedia(
  pageUrl: string,
  onMedia: (media: RawNetworkMedia) => void,
  onDegraded?: (message: string) => void,
  timeoutMs = 10000,
): Promise<void> {
  const seen = new Set<string>();
  let browser: Browser | null = null;

  try {
    const session = await openSession();
    browser = session.browser;
    const page = session.page;
    if (session.note) onDegraded?.(session.note);

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
    // Best-effort — static extraction still runs regardless. Reported rather
    // than swallowed: a browser that won't start looks identical to "this page
    // has no media", so without this the scan quietly returns partial results
    // and every client-rendered site looks empty.
    const message = (error as Error).message;
    console.warn("[pullsrc] network media capture failed:", message);
    onDegraded?.(message);
  } finally {
    await browser?.close().catch(() => {});
  }
}
