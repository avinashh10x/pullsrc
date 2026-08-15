import JSZip from "jszip";

import { buildCreditSheet } from "@/lib/pullsrc/credit";
import { CATEGORY_LABEL, CATEGORY_ORDER } from "@/lib/pullsrc/types";
import type { Asset, AssetCategory, ScanResult } from "@/lib/pullsrc/types";

import { assembleAssets } from "./assemble";
import { collectSnapshot } from "./collect";
import { assembleStream, downloadAsset } from "./download";
import { icon } from "./icons";
import type { CaptureState, PageSnapshot } from "./shared";

const byId = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const pageEl = byId<HTMLSpanElement>("page");
const scanningEl = byId<HTMLDivElement>("scanning");
const emptyEl = byId<HTMLDivElement>("empty");
const tabsEl = byId<HTMLElement>("tabs");
const listEl = byId<HTMLElement>("list");
const footEl = byId<HTMLElement>("foot");
const zipBtn = byId<HTMLButtonElement>("zip");
const creditBtn = byId<HTMLButtonElement>("credit");
const rescanBtn = byId<HTMLButtonElement>("rescan");
const bulkEl = byId<HTMLDivElement>("bulk");
const bulkCountEl = byId<HTMLSpanElement>("bulk-count");
const bulkClearBtn = byId<HTMLButtonElement>("bulk-clear");
const bulkSaveBtn = byId<HTMLButtonElement>("bulk-save");

let result: ScanResult | null = null;
let active: AssetCategory | "all" = "all";
const selected = new Set<string>();
let scannedUrl = "";

// ~1MB, so only loaded when a page actually has 3D assets.
let modelViewerLoad: Promise<unknown> | null = null;
function ensureModelViewer(): Promise<unknown> {
  modelViewerLoad ??= import("@google/model-viewer").catch(() => null);
  return modelViewerLoad;
}

function show(view: "scanning" | "results" | "empty"): void {
  scanningEl.hidden = view !== "scanning";
  emptyEl.hidden = view !== "empty";
  tabsEl.hidden = view !== "results";
  footEl.hidden = view !== "results";
  if (view !== "results") {
    listEl.replaceChildren();
    bulkEl.hidden = true;
  }
}

function renderScanning(url: string): void {
  scanningEl.innerHTML = `
    <div class="scan-head"><span class="spinner"></span><span>Analysing ${escapeHtml(
      shortHost(url),
    )}…</span></div>
    <ul class="scan-list">
      ${CATEGORY_ORDER.map(
        (category) => `
        <li class="scan-row">
          <span class="scan-chip">${icon(category)}</span>
          <span style="flex:1">${CATEGORY_LABEL[category]}</span>
          <span class="spinner"></span>
        </li>`,
      ).join("")}
    </ul>
    <p class="note">Reading the page you're on — images, fonts, colours and
    media it has actually loaded.</p>`;
  show("scanning");
}

function renderEmpty(title: string, body: string, isError = false): void {
  emptyEl.className = `empty${isError ? " error" : ""}`;
  emptyEl.innerHTML = `<strong>${escapeHtml(title)}</strong>${escapeHtml(body)}`;
  show("empty");
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function shortHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url?.startsWith("http")) return tab;

  // Focus can sit on a chrome:// or extension page while the user still means
  // "the site I was just on". Fall back to the most recent web tab rather than
  // showing a dead end — the header names whichever page ends up scanned.
  const [recent] = await chrome.tabs.query({
    currentWindow: true,
    url: ["http://*/*", "https://*/*"],
  });
  return recent ?? tab ?? null;
}

/** Chrome lists the top frame first, so it supplies the page identity. */
function mergeFrames(frames: PageSnapshot[], fallbackUrl: string): PageSnapshot {
  const top = frames[0];
  const merged: PageSnapshot = {
    pageUrl: top?.pageUrl ?? fallbackUrl,
    pageTitle: top?.pageTitle ?? fallbackUrl,
    resources: [],
    colors: top?.colors ?? [],
    fonts: [],
  };

  const seenResource = new Set<string>();
  const seenFont = new Set<string>();
  for (const frame of frames) {
    for (const resource of frame.resources) {
      if (seenResource.has(resource.url)) continue;
      seenResource.add(resource.url);
      merged.resources.push(resource);
    }
    for (const font of frame.fonts) {
      if (seenFont.has(font.url)) continue;
      seenFont.add(font.url);
      merged.fonts.push(font);
    }
  }
  return merged;
}

async function scan(): Promise<void> {
  const tab = await activeTab();
  if (!tab?.id || !tab.url?.startsWith("http")) {
    pageEl.textContent = "";
    renderEmpty(
      "Nothing to scan here",
      "Open a normal web page — browser and extension pages are locked down by Chrome.",
    );
    return;
  }

  pageEl.textContent = shortHost(tab.url);
  renderScanning(tab.url);

  let snapshot: PageSnapshot;
  try {
    // allFrames: embedded players and demo sandboxes live in iframes.
    const injected = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: collectSnapshot,
    });
    snapshot = mergeFrames(
      injected
        .map((frame) => frame.result as PageSnapshot | undefined)
        .filter((frame): frame is PageSnapshot => Boolean(frame)),
      tab.url,
    );
  } catch {
    renderEmpty(
      "This page can't be inspected",
      "Chrome blocks extensions on its own pages and on the Web Store.",
      true,
    );
    return;
  }

  const capture: CaptureState = await chrome.runtime.sendMessage({
    type: "GET_CAPTURE",
    tabId: tab.id,
  });

  // A late load event on the same page must not discard ticked checkboxes.
  if (tab.url !== scannedUrl) {
    selected.clear();
    active = "all";
  }
  scannedUrl = tab.url;

  try {
    result = await assembleAssets(snapshot, capture?.media ?? []);
  } catch (error) {
    renderEmpty("Scan failed", (error as Error).message, true);
    return;
  }

  if (result.assets.length === 0) {
    renderEmpty(
      "No assets found",
      "Media is captured as the page loads it. Play the video or scroll, then press Rescan.",
    );
    return;
  }

  render();
}

function render(): void {
  if (!result) return;
  show("results");

  const counts = new Map<AssetCategory, number>();
  for (const asset of result.assets) {
    counts.set(asset.category, (counts.get(asset.category) ?? 0) + 1);
  }

  tabsEl.replaceChildren();
  const entries: Array<[AssetCategory | "all", string, number, string]> = [
    ["all", "All", result.assets.length, icon("images")],
    ...CATEGORY_ORDER.filter((category) => counts.get(category)).map(
      (category) =>
        [
          category,
          CATEGORY_LABEL[category],
          counts.get(category)!,
          icon(category),
        ] as [AssetCategory, string, number, string],
    ),
  ];
  for (const [key, label, count, glyph] of entries) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "tab";
    tab.setAttribute("aria-selected", String(active === key));
    tab.innerHTML = `${key === "all" ? "" : glyph}<span>${label}</span><span class="n">${count}</span>`;
    tab.onclick = () => {
      active = key;
      render();
    };
    tabsEl.append(tab);
  }

  listEl.replaceChildren();
  for (const asset of result.assets) {
    if (active !== "all" && asset.category !== active) continue;
    listEl.append(card(asset));
  }
  renderBulk();
}

function renderBulk(): void {
  bulkEl.hidden = selected.size === 0;
  document.body.classList.toggle("has-selection", selected.size > 0);
  bulkCountEl.textContent = `${selected.size} selected`;
}

function preview(asset: Asset): HTMLElement {
  const box = document.createElement("div");
  box.className = "preview";

  if (asset.category === "colors") {
    box.style.background = asset.hex;
    box.innerHTML = `<span class="hexlabel">${asset.hex.toUpperCase()}</span>`;
    return box;
  }

  if (asset.category === "images" || asset.category === "logo") {
    const img = document.createElement("img");
    img.src = asset.url;
    img.loading = "lazy";
    img.onerror = () => {
      box.innerHTML = icon(asset.category) + typeTag(asset.fileType);
    };
    box.append(img);
    return box;
  }

  if (asset.category === "fonts") {
    // A real @font-face, so the card shows the typeface not just its name.
    const family = `pf-${asset.id}`;
    const style = document.createElement("style");
    style.textContent = `@font-face{font-family:"${family}";src:url("${asset.url}");font-display:swap}`;
    const label = document.createElement("div");
    label.className = "font-preview";
    label.style.fontFamily = `"${family}", ui-sans-serif, system-ui`;
    label.textContent = asset.fontFamily || "Abc";
    box.append(style, label);
    return box;
  }

  if (asset.category === "video" && !asset.wasStreaming) {
    const video = document.createElement("video");
    video.src = asset.url;
    video.muted = true;
    video.preload = "metadata";
    video.controls = true;
    video.playsInline = true;
    video.onerror = () => {
      box.innerHTML = icon("video") + typeTag(asset.fileType);
    };
    box.append(video);
    return box;
  }

  if (asset.category === "audio" && !asset.wasStreaming) {
    const audio = document.createElement("audio");
    audio.src = asset.url;
    audio.controls = true;
    audio.preload = "metadata";
    audio.style.cssText = "width:92%";
    box.append(audio);
    return box;
  }

  if (asset.category === "model3d") {
    // Icon first: a 5 MB GLB must never block the grid from rendering.
    box.innerHTML = icon("model3d") + typeTag(asset.fileType);
    void ensureModelViewer().then((mod) => {
      if (!mod) return;
      const viewer = document.createElement("model-viewer");
      viewer.setAttribute("src", asset.url);
      viewer.setAttribute("camera-controls", "");
      viewer.setAttribute("auto-rotate", "");
      viewer.setAttribute("disable-zoom", "");
      viewer.setAttribute("touch-action", "pan-y");
      viewer.setAttribute("shadow-intensity", "1");
      viewer.addEventListener("error", () => {
        box.innerHTML = icon("model3d") + typeTag(asset.fileType);
      });
      box.replaceChildren(viewer);
      box.insertAdjacentHTML("beforeend", typeTag(asset.fileType));
    });
    return box;
  }

  box.innerHTML = icon(asset.category) + typeTag(asset.fileType);
  return box;
}

function typeTag(fileType: string): string {
  return `<span class="type">${escapeHtml(fileType)}</span>`;
}

function card(asset: Asset): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "card";

  // Colours have nothing to download.
  if (asset.category !== "colors") {
    const pick = document.createElement("input");
    pick.type = "checkbox";
    pick.className = "pick";
    pick.checked = selected.has(asset.id);
    pick.title = "Select for bulk download";
    pick.onchange = () => {
      if (pick.checked) selected.add(asset.id);
      else selected.delete(asset.id);
      wrapper.classList.toggle("picked", pick.checked);
      renderBulk();
    };
    wrapper.classList.toggle("picked", pick.checked);
    wrapper.append(pick);
  }

  const gutter = document.createElement("div");
  gutter.className = "preview-wrap";
  gutter.append(preview(asset));
  wrapper.append(gutter);

  const info = document.createElement("div");
  info.className = "info";

  const line = document.createElement("p");
  line.className = "line";
  const label =
    asset.category === "colors" ? asset.hex.toUpperCase() : asset.name;

  const meta: string[] = [asset.fileType];
  if (asset.size !== "—") meta.push(asset.size);
  if (asset.category === "fonts") {
    meta.push(`${asset.weights.length} weight${asset.weights.length === 1 ? "" : "s"}`);
  }
  if (asset.category === "video" && asset.audioUrl) meta.push("video + audio");
  if (
    (asset.category === "video" || asset.category === "audio") &&
    asset.wasStreaming
  ) {
    meta.push("stream");
  }

  line.innerHTML =
    `<span class="name">${escapeHtml(label)}</span>` +
    `<span class="meta"> · ${escapeHtml(meta.join(" · "))}</span>`;
  line.title = `${label} · ${meta.join(" · ")}`;

  const actions = document.createElement("div");
  actions.className = "actions";

  const action = document.createElement("button");
  action.className = "icon-btn";
  action.type = "button";

  if (asset.category === "colors") {
    action.title = "Copy hex";
    action.innerHTML = icon("copy");
    action.onclick = async () => {
      await navigator.clipboard.writeText(asset.hex);
      action.textContent = "✓";
    };
  } else {
    action.title = "Download";
    action.innerHTML = icon("download");
    action.onclick = async () => {
      action.disabled = true;
      try {
        await downloadAsset(asset, (progress) => {
          action.textContent =
            progress.total > 1
              ? `${Math.round((progress.done / progress.total) * 100)}`
              : "…";
        });
        action.textContent = "✓";
      } catch (error) {
        action.textContent = "!";
        action.title = (error as Error).message;
      } finally {
        action.disabled = false;
      }
    };
  }
  actions.append(action);

  info.append(line, actions);
  wrapper.append(info);
  return wrapper;
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  void chrome.downloads.download({ url, filename });
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

creditBtn.onclick = () => {
  if (!result) return;
  saveBlob(
    new Blob([buildCreditSheet(result)], { type: "text/plain" }),
    `PullSRC/${result.sourceDomain}-credit-sheet.txt`,
  );
};

async function zipAssets(
  assets: Asset[],
  button: HTMLButtonElement,
  filename: string,
): Promise<void> {
  if (!result) return;
  button.disabled = true;
  const label = button.textContent;
  const zip = new JSZip();
  const files = assets.filter(
    (asset) => asset.category !== "colors" && "url" in asset,
  );

  let done = 0;
  for (const asset of files) {
    button.textContent = `${++done} / ${files.length}`;
    try {
      const streaming =
        (asset.category === "video" || asset.category === "audio") &&
        asset.wasStreaming;
      const source = streaming
        ? (await assembleStream(asset.url)).url
        : (asset as Asset & { url: string }).url;
      const res = await fetch(source, { credentials: "include" });
      if (!res.ok) continue;
      zip.folder(asset.category)?.file(asset.name, await res.blob());
      // Without its partner track the video is silent.
      if (asset.category === "video" && asset.audioUrl && asset.audioName) {
        const audio = await fetch(asset.audioUrl, { credentials: "include" });
        if (audio.ok) zip.folder(asset.category)?.file(asset.audioName, await audio.blob());
      }
    } catch {
      // Skip what fails; a partial export beats no export.
    }
  }
  zip.file("credit-sheet.txt", buildCreditSheet({ ...result, assets }));

  saveBlob(await zip.generateAsync({ type: "blob" }), filename);
  button.textContent = label;
  button.disabled = false;
}

zipBtn.onclick = () => {
  if (!result) return;
  void zipAssets(result.assets, zipBtn, `PullSRC/${result.sourceDomain}-assets.zip`);
};

bulkClearBtn.onclick = () => {
  selected.clear();
  render();
};

bulkSaveBtn.onclick = () => {
  if (!result) return;
  const picked = result.assets.filter((asset) => selected.has(asset.id));
  if (picked.length === 0) return;
  // One file goes straight to disk; several are worth bundling.
  if (picked.length === 1) {
    void downloadAsset(picked[0]);
    return;
  }
  void zipAssets(picked, bulkSaveBtn, `PullSRC/${result.sourceDomain}-selected.zip`);
};

rescanBtn.onclick = () => void scan();

// Keep the panel describing whatever tab the user is actually looking at.
chrome.tabs.onActivated.addListener(() => void scan());
chrome.tabs.onUpdated.addListener((_id, change, tab) => {
  if (change.status === "complete" && tab.active) void scan();
});

void scan();
