import {
  canonicalMediaUrl,
  classifyMediaUrl,
} from "@/lib/pullsrc/media-classify";

import { SESSION_KEY, isHttp, type CaptureState, type CapturedMedia } from "./shared";

// The browser already loaded the page, so webRequest gets the media list for
// free — and from a real session, so login-gated pages work.

// MV3 kills the worker after ~30s idle, so state write-throughs to session
// storage, which survives the restart but not the browser closing.
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
    // A cold profile has nothing stored.
  }
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleFlush(): void {
  if (flushTimer) return;
  // Media arrives in bursts; batching keeps this off the hot path.
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

// Must register synchronously, or a restarted worker misses the waking event.
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

// Sub-frame and history changes are ignored: an SPA route change usually keeps
// the same media in play.
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
  return true; // keeps the channel open for the async reply

});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
});
