import type { Asset, ScanResult } from "./types";

export function creditLine(asset: Asset): string {
  return `"${asset.name}" via ${asset.credit.sourceDomain} — ${asset.credit.pageTitle} (${asset.credit.originalUrl}), retrieved ${asset.credit.scanDate}`;
}

export const LEGAL_NOTICE = [
  "Every asset listed below was pulled directly from the page above and",
  "remains the property of its original owner/site. PullSRC does not claim",
  "ownership of, or grant any license to, this content — it only helps you",
  "locate and reference what's already publicly visible on that page.",
  "",
  "Do not use anything listed here for commercial purposes, redistribution,",
  "or public-facing work without first getting explicit permission from the",
  "original owner. When in doubt, ask before you use it.",
].join("\n");

export function buildCreditSheet(result: ScanResult): string {
  const lines = result.assets.map((asset) => `- ${creditLine(asset)}`);
  return [
    "PULLSRC — SOURCE CREDIT SHEET",
    "==============================",
    "",
    `Page: ${result.pageTitle}`,
    result.pageUrl,
    `Scanned: ${result.scanDate}`,
    "",
    "LEGAL NOTICE",
    "------------",
    LEGAL_NOTICE,
    "",
    "ASSETS",
    "------",
    ...lines,
  ].join("\n");
}
