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
  credit: CreditInfo
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
}

export interface AudioAsset extends BaseAsset {
  category: "audio"
  url: string
}

export interface Model3DAsset extends BaseAsset {
  category: "model3d"
  url: string
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
  | { type: "done" }
