import {
  canonicalMediaUrl,
  classifyMediaUrl,
} from "@/lib/pullsrc/media-classify";

import { SESSION_KEY, isHttp, type CaptureState, type CapturedMedia } from "./shared";

// The web app has to drive a headless browser and force-play every media
// element to discover what a page loads. Here the user's own browser is already
// doing that, so watching chrome.webRequest gets the same list for free — and
// gets it from a real session, so login-gated pages work too.

// MV3 service workers are killed after ~30s idle, taking module state with
// them. Everything therefore write-throughs to session storage, which survives
// the restart but is cleared when the browser closes.
const captures = new Map<number, CaptureState>();
let restored = false;

async function restore(): Promise<void> {
  if (restored) return;
  restored = true;
  try {
    const stored = await chrome.storage.session.get(SESSION_KEY);
    const raw = stored[SESSION_KEY] as Record<string, CaptureState> | undefined;
    for (const [tabId, state] of Object.entries(raw ?? {})) {
      captures.set(Number(tabId), state);
    }
  } catch {
    // A cold profile has nothing stored; that's the normal case, not an error.
  }
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleFlush(): void {
  if (flushTimer) return;
  // Media arrives in bursts, so batching keeps this off the hot path.
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void chrome.storage.session.set({
      [SESSION_KEY]: Object.fromEntries(captures),
    });
  }, 400);
}

function stateFor(tabId: number, pageUrl: string): CaptureState {
  const existing = captures.get(tabId);
  if (existing) return existing;
  const fresh: CaptureState = { pageUrl, media: [] };
  captures.set(tabId, fresh);
  return fresh;
}

function headerValue(
  headers: chrome.webRequest.HttpHeader[] | undefined,
  name: string,
): string {
  const found = headers?.find(
    (header) => header.name.toLowerCase() === name.toLowerCase(),
  );
  return found?.value ?? "";
}

// Listeners must be registered synchronously at the top level, or a restarted
// service worker misses the events that woke it.
chrome.webRequest.onHeadersReceived.addListener(
  (details): undefined => {
    if (details.tabId < 0 || !isHttp(details.url)) return;

    const url = canonicalMediaUrl(details.url);
    const contentType = headerValue(details.responseHeaders, "content-type")
      .split(";")[0]
      .trim();

    const classified = classifyMediaUrl(url, contentType);
    if (!classified) return;

    const state = stateFor(details.tabId, details.initiator ?? details.url);
    if (state.media.some((item) => item.url === url)) return;

    const length = Number(headerValue(details.responseHeaders, "content-length"));

    const media: CapturedMedia = {
      url,
      kind: classified.kind,
      isStreaming: classified.isStreaming,
      contentType,
      sizeBytes: Number.isFinite(length) && length > 0 ? length : null,
    };
    state.media.push(media);
    scheduleFlush();
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"],
);

// A top-level navigation means the previous page's media is no longer what the
// user is looking at. Sub-frame and history changes are deliberately ignored,
// since a SPA route change usually keeps the same media in play.
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  if (details.transitionQualifiers?.includes("server_redirect")) return;
  captures.set(details.tabId, { pageUrl: details.url, media: [] });
  scheduleFlush();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  captures.delete(tabId);
  scheduleFlush();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    await restore();
    if (message?.type === "GET_CAPTURE") {
      sendResponse(captures.get(message.tabId) ?? { pageUrl: "", media: [] });
      return;
    }
    if (message?.type === "CLEAR") {
      captures.set(message.tabId, { pageUrl: "", media: [] });
      scheduleFlush();
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false });
  })();
  // Keeps the message channel open for the async reply above.
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
});
