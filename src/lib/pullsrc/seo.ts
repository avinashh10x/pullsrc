// One source for copy that exists twice: on the page and in JSON-LD. Google
// flags schema that isn't on the page, so the two must not drift.

export const SITE_URL = "https://pullsrc.byavi.in";

export const HOW_IT_WORKS = [
  {
    title: "Paste a page URL",
    body: "Give PullSRC the address of the specific page you want, not just the domain — assets live on pages, not homepages.",
  },
  {
    title: "PullSRC opens the page for real",
    body: "A headless browser loads the page the way your browser does, so assets injected by JavaScript and media requested over the network get caught too, not just what's in the raw HTML.",
  },
  {
    title: "Review and export",
    body: "Assets stream in by category as they're found. Pick what you need, download individually or as a ZIP, and take the credit sheet with you.",
  },
] as const;

export const EXTRACTED = [
  {
    title: "Images",
    body: "Every image the page loads, including ones pulled in by scripts, CSS backgrounds, and responsive srcsets.",
  },
  {
    title: "Logos",
    body: "PullSRC flags the images most likely to be the site's logo so you don't have to hunt for it.",
  },
  {
    title: "Fonts",
    body: "Web font files with their family name and the weights the page actually loads.",
  },
  {
    title: "Colors",
    body: "The palette the page renders with, collected as hex values you can copy straight into a design file.",
  },
  {
    title: "Video",
    body: "Direct video files plus HLS (m3u8) streams, with the available quality renditions listed separately.",
  },
  {
    title: "Audio",
    body: "Audio files and streams the page requests, including background and embedded players.",
  },
  {
    title: "3D models",
    body: "glTF and GLB models embedded in the page, previewable before you download.",
  },
] as const;

export const FAQ = [
  {
    q: "What is PullSRC?",
    a: "PullSRC is a free browser-based tool that extracts every asset from a webpage. Paste a page URL and it returns the images, logos, fonts, colors, video, audio, and 3D models that page loads, along with a credit sheet recording where each one came from.",
  },
  {
    q: "Do I need to install anything?",
    a: "No. PullSRC runs entirely in your browser. There is no extension, no desktop app, and no account to create.",
  },
  {
    q: "How is this different from using browser DevTools?",
    a: "DevTools shows you the network panel and leaves the sorting to you. PullSRC loads the page in a real headless browser, groups what it finds into categories, names and sizes each file, and lets you bulk-download a selection as a ZIP.",
  },
  {
    q: "Can PullSRC download video from a website?",
    a: "Yes, including HLS streams served as .m3u8 playlists — PullSRC lists the quality renditions it finds so you can pick one. Video protected by DRM (Widevine, FairPlay) cannot be extracted and is labelled as such.",
  },
  {
    q: "Can PullSRC extract fonts from a website?",
    a: "Yes. PullSRC collects the web font files a page loads and reports the font family and the weights in use, so you can identify a typeface even if you don't end up downloading it.",
  },
  {
    q: "Does it work on pages behind a login?",
    a: "No. PullSRC only sees what a page shows to an anonymous visitor, so anything gated behind authentication, a paywall, or a bot check won't be reachable.",
  },
  {
    q: "What is the credit sheet?",
    a: "A plain-text record of every asset found, listing its source domain, the page title, the original URL, and the date scanned. It exists so you can attribute what you use and keep a trail of where it came from.",
  },
  {
    q: "Can I use the assets I find commercially?",
    a: "Not without permission. Everything PullSRC surfaces stays the property of its original owner. PullSRC only helps you locate and reference what is already publicly visible on a page — it grants no license. Get explicit permission from the owner before using anything in commercial or public-facing work.",
  },
  {
    q: "Is PullSRC free?",
    a: "Yes. PullSRC is free to use with no account required.",
  },
] as const;

const DESCRIPTION =
  "Paste any webpage URL and instantly extract images, fonts, colors, videos, and 3D models with credit details for your next design or build.";

export function buildJsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: "PullSRC",
        description: DESCRIPTION,
        inLanguage: "en",
        publisher: { "@id": `${SITE_URL}/#person` },
      },
      {
        "@type": "Person",
        "@id": `${SITE_URL}/#person`,
        name: "Avi",
        url: "https://byavi.in",
      },
      {
        "@type": "WebApplication",
        "@id": `${SITE_URL}/#app`,
        name: "PullSRC",
        alternateName: "PullSRC website asset extractor",
        url: SITE_URL,
        description: DESCRIPTION,
        applicationCategory: "DesignApplication",
        applicationSubCategory: "Website asset extractor",
        operatingSystem: "Any (web browser)",
        browserRequirements: "Requires JavaScript.",
        isAccessibleForFree: true,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
        featureList: EXTRACTED.map((item) => `${item.title} — ${item.body}`),
        screenshot: `${SITE_URL}/og.png`,
        author: { "@id": `${SITE_URL}/#person` },
      },
      {
        "@type": "FAQPage",
        "@id": `${SITE_URL}/#faq`,
        mainEntity: FAQ.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      },
      {
        "@type": "HowTo",
        "@id": `${SITE_URL}/#howto`,
        name: "How to extract every asset from a webpage",
        description:
          "Pull the images, fonts, colors, video, audio, and 3D models out of any public webpage using PullSRC.",
        totalTime: "PT1M",
        step: HOW_IT_WORKS.map((item, index) => ({
          "@type": "HowToStep",
          position: index + 1,
          name: item.title,
          text: item.body,
        })),
      },
    ],
  };
}
