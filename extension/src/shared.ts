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
  fonts: Array<{ family: string; url: string; weights: string[] }>;
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
