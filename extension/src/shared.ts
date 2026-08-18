import type { FontSource } from "@/lib/pullsrc/font-assets";
import type { MediaKind } from "@/lib/pullsrc/media-classify";

// Wire format between worker, content script and panel. One file, because a
// mismatch between the three is invisible until runtime.

export interface CapturedMedia {
  url: string;
  kind: MediaKind;
  isStreaming: boolean;
  contentType: string;
  sizeBytes: number | null;
}

export interface PageResource {
  url: string;
  /** Where the content script found it, used to label and rank candidates. */
  origin: "img" | "srcset" | "css" | "video" | "audio" | "model" | "resource";
  alt?: string;
  looksLikeLogo?: boolean;
}

export interface PageSnapshot {
  pageUrl: string;
  pageTitle: string;
  resources: PageResource[];
  colors: string[];
  // One entry per @font-face src url, so a family that ships .woff2 and .ttf
  // arrives as two — the panel needs both to offer a format menu.
  fonts: FontSource[];
}

export type PanelRequest =
  | { type: "GET_CAPTURE"; tabId: number }
  | { type: "CLEAR"; tabId: number };

export interface CaptureState {
  pageUrl: string;
  media: CapturedMedia[];
}

export const SESSION_KEY = "pullsrc:capture";

export function isHttp(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}
