import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/pullsrc/seo";

// /scan is a tool surface keyed on ?url=, so it's an unbounded set of
// near-identical pages with no content of its own. Keeping crawlers off it
// protects crawl budget; the page itself also sends noindex.
const DISALLOW = ["/api/", "/scan"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: DISALLOW,
      },
      {
        // Answer engines, listed explicitly: being quoted in an AI answer is a
        // real acquisition channel for a tool like this, and the *-Extended
        // tokens are the opt-in/opt-out signal for training and grounding.
        userAgent: [
          "GPTBot",
          "OAI-SearchBot",
          "ChatGPT-User",
          "ClaudeBot",
          "Claude-User",
          "Claude-SearchBot",
          "PerplexityBot",
          "Perplexity-User",
          "Google-Extended",
          "Applebot-Extended",
          "meta-externalagent",
          "cohere-ai",
        ],
        allow: "/",
        disallow: DISALLOW,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
