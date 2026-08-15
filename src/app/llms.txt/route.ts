import { EXTRACTED, FAQ, HOW_IT_WORKS, SITE_URL } from "@/lib/pullsrc/seo";

// A markdown summary for answer engines, generated from seo.ts so it can't
// drift from the page. Nothing reads the request, so it bakes at build time.
export const dynamic = "force-static";

export function GET() {
  const body = [
    "# PullSRC",
    "",
    "> A free, browser-based tool that extracts every asset from a webpage. Paste a page URL and PullSRC returns the images, logos, fonts, colors, video, audio, and 3D models that page loads, plus a credit sheet recording where each one came from.",
    "",
    `Site: ${SITE_URL}`,
    "Price: Free. No account, no install, no extension.",
    "Built by: Avi (https://byavi.in)",
    "",
    "## How it works",
    "",
    ...HOW_IT_WORKS.map((step, i) => `${i + 1}. **${step.title}** — ${step.body}`),
    "",
    "## What it extracts",
    "",
    ...EXTRACTED.map((item) => `- **${item.title}**: ${item.body}`),
    "",
    "## Limits",
    "",
    "- Only public pages. Anything behind a login, paywall, or bot check is unreachable.",
    "- DRM-protected video (Widevine, FairPlay) cannot be extracted and is labelled as such.",
    "- Needs a specific page URL, not just a domain — assets live on pages.",
    "",
    "## Licensing",
    "",
    "PullSRC claims no ownership of and grants no license to anything it surfaces. Every asset remains the property of its original owner. PullSRC only helps locate and reference what is already publicly visible on a page. Get explicit permission from the owner before any commercial, redistributed, or public-facing use.",
    "",
    "## FAQ",
    "",
    ...FAQ.flatMap((item) => [`### ${item.q}`, "", item.a, ""]),
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
