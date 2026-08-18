import JSZip from "jszip";

import { buildCreditSheet } from "@/lib/pullsrc/credit";
import { modelExtension, modelRenderer } from "@/lib/pullsrc/model3d";
import { SITE_URL, SUPPORT_URL } from "@/lib/pullsrc/seo";
import { CATEGORY_LABEL, CATEGORY_ORDER } from "@/lib/pullsrc/types";
import type {
  Asset,
  AssetCategory,
  MediaVariant,
  ScanResult,
} from "@/lib/pullsrc/types";

import { assembleAssets } from "./assemble";
import { collectSnapshot } from "./collect";
import {
  assetBlob,
  assembleStream,
  downloadAsset,
  downloadVariant,
} from "./download";
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
const siteLink = byId<HTMLAnchorElement>("site-link");
const supportLink = byId<HTMLAnchorElement>("support-link");

siteLink.href = SITE_URL;
supportLink.href = SUPPORT_URL;

// The footer is fixed, so the grid clears it by exactly its height — measured,
// because the selection row and wrapped button labels both change it.
function syncFootPadding(): void {
  const height = footEl.getBoundingClientRect().height;
  document.body.style.paddingBottom = `${height + 8}px`;
}

new ResizeObserver(syncFootPadding).observe(footEl);

let result: ScanResult | null = null;
let active: AssetCategory | "all" = "all";
const selected = new Set<string>();
let scannedUrl = "";

// ~1MB, so only loaded when a page actually has 3D assets. Its Draco and KTX2
// decoders default to www.gstatic.com — remotely hosted code, which MV3 forbids
// — so they are repointed at the copies bundled under vendor/.
let modelViewerLoad: Promise<unknown> | null = null;
function ensureModelViewer(): Promise<unknown> {
  modelViewerLoad ??= import("@google/model-viewer")
    .then((mod) => {
      const element = mod.ModelViewerElement as unknown as {
        dracoDecoderLocation: string;
        ktx2TranscoderLocation: string;
      };
      element.dracoDecoderLocation = chrome.runtime.getURL("vendor/draco/");
      element.ktx2TranscoderLocation = chrome.runtime.getURL("vendor/ktx2/");
      return mod;
    })
    .catch(() => null);
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
  syncFootPadding();
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
      // A url can legitimately appear under two families, and each weight is
      // its own entry, so the family and weight are part of the identity.
      const key = `${font.fontFamily}|${font.weight}|${font.url}`;
      if (seenFont.has(key)) continue;
      seenFont.add(key);
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
  bulkCountEl.textContent = `${selected.size} selected`;
  syncFootPadding();
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
    const restore = (note?: string) => {
      box.innerHTML =
        icon("model3d") +
        (note ? `<span class="preview-note">${escapeHtml(note)}</span>` : "") +
        typeTag(asset.fileType);
    };

    const kind = modelRenderer(asset.url, asset.fileType);

    if (kind === "gltf") {
      void ensureModelViewer().then((mod) => {
        if (!mod) return;
        const viewer = document.createElement("model-viewer");
        viewer.setAttribute("src", asset.url);
        viewer.setAttribute("camera-controls", "");
        viewer.setAttribute("auto-rotate", "");
        viewer.setAttribute("autoplay", "");
        viewer.setAttribute("disable-zoom", "");
        viewer.setAttribute("touch-action", "pan-y");
        viewer.setAttribute("shadow-intensity", "1");
        viewer.addEventListener("error", () => restore("Couldn't load model"));
        box.replaceChildren(viewer);
        box.insertAdjacentHTML("beforeend", typeTag(asset.fileType));
      });
      return box;
    }

    if (kind === "three") {
      // No proxy fallback: host permissions let the panel fetch it directly.
      const canvas = document.createElement("canvas");
      void import("@/lib/pullsrc/model3d-viewer")
        .then(({ mountModel3D }) =>
          mountModel3D(canvas, {
            urls: [asset.url],
            ext: modelExtension(asset.url, asset.fileType),
          }),
        )
        .then(() => {
          box.replaceChildren(canvas);
          box.insertAdjacentHTML("beforeend", typeTag(asset.fileType));
        })
        .catch(() => restore("Couldn't load model"));
      return box;
    }

    restore("No preview for this format");
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
    // The page never served a .ttf, so say where this one comes from rather
    // than implying the site had it all along.
    if (asset.convertFrom) meta.push(`from ${asset.convertFrom.toUpperCase()}`);
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

  const variants = "variants" in asset ? (asset.variants ?? []) : [];

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
        // A 28px button can't hold a sentence. The dialog can, and it also
        // offers the formats that would have worked instead.
        if (variants.length > 1) {
          openVariantDialog(asset, variants, (error as Error).message);
        }
      } finally {
        action.disabled = false;
      }
    };
  }
  actions.append(action);

  if (variants.length > 1) actions.append(variantMenu(asset, variants));

  info.append(line, actions);
  wrapper.append(info);
  return wrapper;
}

// "1080p" means nothing to most people; "Full HD" does. Ordered high to low
// and matched on the first threshold the height clears.
const QUALITY_NAMES: Array<[number, string]> = [
  [2160, "4K Ultra HD"],
  [1440, "2K"],
  [1080, "Full HD"],
  [720, "HD"],
  [480, "Standard"],
  [0, "Low quality"],
];

// A filename tells the user nothing about which download to pick. What they
// need is how good it looks and how big it is — or, for a font, which format
// it lands in and whether that one installs.
function variantLabel(
  variant: MediaVariant,
  siblings: MediaVariant[],
): { title: string; detail: string } {
  if (variant.drmProtected) return { title: "Protected", detail: "can't download" };
  if (variant.wasStreaming) {
    return { title: "Stream", detail: "assembled on download" };
  }
  if (variant.convertFont) {
    // The wrapper it came out of is the same file offered unconverted, so the
    // sibling entry names the source without the card having to carry it.
    const source = siblings.find(
      (other) => other.url === variant.url && !other.convertFont,
    );
    return {
      title: variant.fileType,
      detail: source ? `from ${source.fileType}` : "converted",
    };
  }
  if (/^original$/i.test(variant.quality ?? "")) {
    return { title: "Original", detail: "full quality" };
  }
  const height = Number(/^(\d{3,4})p$/i.exec(variant.quality ?? "")?.[1] ?? 0);
  if (height) {
    return {
      title: QUALITY_NAMES.find(([min]) => height >= min)?.[1] ?? "Low quality",
      detail: variant.quality ?? "",
    };
  }
  return { title: variant.fileType, detail: "" };
}

/**
 * The chevron beside the download button. It opens a modal rather than a panel
 * inside the card: the grid puts every card in a row on the same track, so
 * anything that grows a card taller shoves its whole row down.
 */
function variantMenu(asset: Asset, variants: MediaVariant[]): HTMLButtonElement {
  const isFont = asset.category === "fonts";

  const toggle = document.createElement("button");
  toggle.className = "icon-btn";
  toggle.type = "button";
  toggle.setAttribute("aria-haspopup", "dialog");
  toggle.title = isFont
    ? `Other formats (${variants.length})`
    : `Other qualities (${variants.length})`;
  toggle.innerHTML = icon("chevron");
  toggle.onclick = () => openVariantDialog(asset, variants);
  return toggle;
}

function showSheetError(dialog: HTMLElement, message: string): void {
  let note = dialog.querySelector<HTMLParagraphElement>(".sheet-error");
  if (!note) {
    note = document.createElement("p");
    note.className = "sheet-error";
    // Above Cancel: it explains the rows, so it belongs with them rather than
    // stranded under the way out.
    const close = dialog.querySelector(".sheet-close");
    if (close) close.before(note);
    else dialog.append(note);
  }
  note.textContent = message;
}

function openVariantDialog(
  asset: Asset,
  variants: MediaVariant[],
  error?: string,
): void {
  const isFont = asset.category === "fonts";

  // <dialog> rather than a hand-rolled overlay: Escape, the backdrop and the
  // focus trap all come with it.
  const dialog = document.createElement("dialog");
  dialog.className = "sheet";

  const head = document.createElement("p");
  head.className = "sheet-head";
  head.textContent = isFont
    ? "Choose a format to download"
    : "Choose a quality to download";

  const name = document.createElement("p");
  name.className = "sheet-name";
  name.textContent =
    asset.category === "fonts" ? asset.fontFamily || asset.name : asset.name;

  dialog.append(name, head);

  for (const variant of variants) {
    const { title, detail } = variantLabel(variant, variants);
    const body =
      `<span class="variant-name">${escapeHtml(title)}</span>` +
      (detail ? `<span class="variant-detail">${escapeHtml(detail)}</span>` : "") +
      (variant.recommended ? `<span class="variant-best">Best</span>` : "") +
      `<span class="variant-size">${escapeHtml(variant.size)}</span>`;

    if (variant.drmProtected) {
      const row = document.createElement("p");
      row.className = "variant disabled";
      row.innerHTML = body;
      dialog.append(row);
      continue;
    }

    const row = document.createElement("button");
    row.className = "variant";
    row.type = "button";
    row.innerHTML = body;
    row.onclick = async () => {
      const size = row.querySelector(".variant-size") as HTMLElement;
      row.disabled = true;
      size.textContent = "…";
      try {
        await downloadVariant(asset, variant);
        size.textContent = "✓";
        // Long enough to read the tick, short enough not to feel stuck.
        setTimeout(() => dialog.close(), 600);
      } catch (error) {
        size.textContent = "!";
        showSheetError(dialog, (error as Error).message);
        row.disabled = false;
      }
    };
    dialog.append(row);
  }

  const close = document.createElement("button");
  close.type = "button";
  close.className = "btn ghost tiny sheet-close";
  close.textContent = "Cancel";
  close.onclick = () => dialog.close();
  dialog.append(close);

  // Clicking the backdrop lands on the dialog itself, never on a child.
  dialog.onclick = (event) => {
    if (event.target === dialog) dialog.close();
  };
  dialog.addEventListener("close", () => dialog.remove());

  document.body.append(dialog);
  dialog.showModal();
  if (error) showSheetError(dialog, error);
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

      if (streaming) {
        const res = await fetch((await assembleStream(asset.url)).url);
        if (!res.ok) continue;
        zip.folder(asset.category)?.file(asset.name, await res.blob());
      } else {
        // Fonts come back unwrapped, so the entry matches the name the card
        // showed instead of being a .woff2 wearing a .ttf label.
        const file = await assetBlob(asset as Asset & { url: string });
        if (!file) continue;
        zip.folder(asset.category)?.file(file.filename, file.blob);
      }
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
