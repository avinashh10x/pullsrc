import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @sparticuz/chromium resolves its own bin/ directory at runtime via
  // import.meta.url, so file tracing can't see it and the 62MB chromium.br
  // never ships — executablePath() would then fail on every deploy. Pull the
  // archives in explicitly for the one route that launches a browser.
  outputFileTracingIncludes: {
    "/api/scan": ["node_modules/@sparticuz/chromium/bin/**/*"],
  },
};

export default nextConfig;
