import type { FontFormat } from "./font-convert"

export type AssetCategory =
  | "images"
  | "fonts"
  | "logo"
  | "colors"
  | "video"
  | "audio"
  | "model3d"

export interface CreditInfo {
  sourceDomain: string
  pageTitle: string
  originalUrl: string
  scanDate: string
}

interface BaseAsset {
  id: string
  category: AssetCategory
  name: string
  fileType: string
  size: string
  // Raw bytes behind `size`, so the proxy can tell a whole file from an
  // expired link returning only a header. Null if the origin gave no length.
  sizeBytes?: number | null
  credit: CreditInfo
}

export interface MediaVariant {
  url: string
  name: string
  fileType: string
  size: string
  // "1080p", "480p", "Original" — what actually distinguishes one rendition
  // from another. Absent when nothing in the source reveals the resolution.
  quality?: string
  wasStreaming: boolean
  drmProtected?: boolean
  recommended?: boolean
  sizeBytes?: number | null
  // Fonts only: this rendition doesn't exist upstream. `url` points at the web
  // wrapper the page ships and the download unwraps it into an installable
  // file first, so `size` describes the source, not what lands on disk.
  convertFont?: boolean
}

export interface ImageAsset extends BaseAsset {
  category: "images"
  url: string
}

export interface FontAsset extends BaseAsset {
  category: "fonts"
  url: string
  fontFamily: string
  weights: string[]
  // Set when the page ships web wrappers only: the headline download unwraps
  // `url` out of this format into the installable file `fileType` names.
  convertFrom?: FontFormat
  // Every format the family was found in, installable one first, so the card
  // can offer the original alongside the wrappers the browser preferred.
  variants?: MediaVariant[]
}

export interface LogoAsset extends BaseAsset {
  category: "logo"
  url: string
  confidence: "likely"
}

export interface ColorAsset extends BaseAsset {
  category: "colors"
  hex: string
}

export interface VideoAsset extends BaseAsset {
  category: "video"
  url: string
  wasStreaming: boolean
  drmProtected?: boolean
  variants?: MediaVariant[]
  // Instagram and Reddit CMAF ship picture and sound separately, so `url`
  // alone is a silent video; its partner track rides along here.
  audioUrl?: string
  audioName?: string
  audioSizeBytes?: number | null
}

export interface AudioAsset extends BaseAsset {
  category: "audio"
  url: string
  wasStreaming: boolean
  drmProtected?: boolean
  variants?: MediaVariant[]
}

export interface Model3DAsset extends BaseAsset {
  category: "model3d"
  url: string
  variants?: MediaVariant[]
}

export type Asset =
  | ImageAsset
  | FontAsset
  | LogoAsset
  | ColorAsset
  | VideoAsset
  | AudioAsset
  | Model3DAsset

export interface ScanResult {
  pageUrl: string
  pageTitle: string
  sourceDomain: string
  scanDate: string
  assets: Asset[]
}

export type ScanErrorKind = "broken" | "blocked" | "invalid"

export interface ScanError {
  kind: ScanErrorKind
  message: string
}

export type ScanCounts = Record<AssetCategory, number>

export const CATEGORY_LABEL: Record<AssetCategory, string> = {
  images: "Images",
  fonts: "Fonts",
  logo: "Logo",
  colors: "Colors",
  video: "Video",
  audio: "Sound",
  model3d: "3D Models",
}

export const CATEGORY_ORDER: AssetCategory[] = [
  "images",
  "fonts",
  "logo",
  "colors",
  "video",
  "audio",
  "model3d",
]

// Streamed as newline-delimited JSON so fast categories render immediately
// while slow ones (video/audio/3d) trickle in as each asset is found.
export type ScanStreamEvent =
  | { type: "meta"; pageUrl: string; pageTitle: string; sourceDomain: string; scanDate: string }
  | { type: "category"; category: AssetCategory; assets: Asset[] }
  | { type: "asset"; asset: Asset }
  | { type: "category-done"; category: AssetCategory }
  | { type: "error"; error: ScanError }
  // Non-fatal: part of the scan degraded (e.g. the headless browser wouldn't
  // start) so results are incomplete. The scan still finishes.
  | { type: "notice"; scope: string; message: string }
  | { type: "done" }
