import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // wawoff2 is an Emscripten build: it sniffs its own environment and requires
  // node's fs at runtime, which bundling rewrites into something that no
  // longer resolves. Left external it is a plain Node require again.
  serverExternalPackages: ["wawoff2"],

  // Both browser packages load files at runtime that static tracing can't
  // see, so they have to be pulled in by hand or the deployed function is
  // missing pieces it only discovers when someone runs a scan:
  //   - @sparticuz/chromium finds its bin/ archives via import.meta.url
  //   - playwright-core requires browsers.json from inside its bundled lib
  // Both are scoped to the one route that launches a browser.
  outputFileTracingIncludes: {
    "/api/scan": [
      "node_modules/@sparticuz/chromium/bin/**/*",
      "node_modules/playwright-core/**/*",
    ],
    // Reached through a dynamic import that only fires on a WOFF2, which
    // static tracing reads as optional and leaves out of the function.
    "/api/font": ["node_modules/wawoff2/**/*"],
  },
};

export default nextConfig;
