import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
  },
};

export default nextConfig;
