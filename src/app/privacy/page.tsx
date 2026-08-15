import type { Metadata } from "next"

import { SITE_URL } from "@/lib/pullsrc/seo"

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What PullSRC and the PullSRC browser extension do and do not collect.",
  alternates: { canonical: "/privacy" },
}

const UPDATED = "15 August 2026"

const EXTENSION_PERMISSIONS = [
  {
    name: "Host access to all sites",
    why: "Assets live on whatever page you are looking at, and the media on it is usually served from a different domain than the page itself. The extension reads that page only while its panel is open and you ask it to scan.",
  },
  {
    name: "webRequest / webNavigation",
    why: "Observes the URLs and content types your browser requests, so media loaded by scripts — video, audio, 3D models — can be listed. It observes only; it never blocks, redirects or alters a request.",
  },
  {
    name: "scripting",
    why: "Reads the page's images, fonts and colours from the rendered DOM. It runs one read-only pass and writes nothing back to the page.",
  },
  {
    name: "downloads",
    why: "Saves the assets you pick, through the browser's own download manager.",
  },
  {
    name: "storage",
    why: "Holds the list of media found on the current tab in session storage so the panel can show it. It is cleared when you close the browser.",
  },
  {
    name: "tabs / sidePanel",
    why: "Tells the panel which tab you are looking at, and opens the panel beside it.",
  },
]

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-16">
      <h1 className="font-heading text-4xl uppercase tracking-normal text-foreground">
        Privacy
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Last updated {UPDATED}
      </p>

      <section className="mt-10 space-y-4">
        <h2 className="text-xl font-medium text-foreground">The short version</h2>
        <p className="text-base leading-7 text-muted-foreground">
          PullSRC has no accounts, no tracking of what you scan, and no database
          of your activity. The browser extension sends nothing to us at all —
          it has no server to send anything to. Everything it finds stays in
          your browser until you choose to download it.
        </p>
      </section>

      <section className="mt-10 space-y-4">
        <h2 className="text-xl font-medium text-foreground">
          The extension
        </h2>
        <p className="text-base leading-7 text-muted-foreground">
          The PullSRC browser extension does not collect, transmit, store or
          sell any personal data. It contacts no PullSRC server. When you scan a
          page, the extension reads that page in your browser and lists what it
          finds; when you download an asset, your browser fetches it directly
          from the site that hosts it. Nothing passes through us.
        </p>
        <p className="text-base leading-7 text-muted-foreground">
          The list of assets found on a tab is kept in your browser&apos;s
          session storage so the panel can display it, and is erased when you
          close your browser.
        </p>

        <h3 className="pt-2 text-base font-medium text-foreground">
          Why it asks for each permission
        </h3>
        <dl className="divide-y divide-border border-y border-border">
          {EXTENSION_PERMISSIONS.map((permission) => (
            <div key={permission.name} className="py-4">
              <dt className="text-sm font-medium text-foreground">
                {permission.name}
              </dt>
              <dd className="mt-1 text-sm leading-6 text-muted-foreground">
                {permission.why}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-10 space-y-4">
        <h2 className="text-xl font-medium text-foreground">The website</h2>
        <p className="text-base leading-7 text-muted-foreground">
          When you scan a URL on{" "}
          <span className="font-mono text-sm text-foreground">
            pullsrc.byavi.in
          </span>
          , our server loads that public page in a headless browser to find its
          assets, and streams the result back to you. The URL you submit is
          processed to answer that request and is not stored afterwards. We keep
          no scan history and no user accounts.
        </p>
        <p className="text-base leading-7 text-muted-foreground">
          The site uses Vercel Analytics for aggregate page-view counts. It sets
          no cookies and does not build a profile of you. The extension does not
          use analytics of any kind.
        </p>
      </section>

      <section className="mt-10 space-y-4">
        <h2 className="text-xl font-medium text-foreground">
          Assets you download
        </h2>
        <p className="text-base leading-7 text-muted-foreground">
          Everything PullSRC surfaces remains the property of its original
          owner. PullSRC grants no licence to it and only helps you locate what
          is already publicly visible on a page. Get permission from the owner
          before using anything in commercial or public-facing work.
        </p>
      </section>

      <section className="mt-10 space-y-4">
        <h2 className="text-xl font-medium text-foreground">Contact</h2>
        <p className="text-base leading-7 text-muted-foreground">
          Questions about this policy can go to{" "}
          <a
            href="https://byavi.in"
            className="font-medium text-foreground underline underline-offset-4"
          >
            byavi.in
          </a>
          .
        </p>
        <p className="text-sm text-muted-foreground">
          Canonical URL: <span className="font-mono">{SITE_URL}/privacy</span>
        </p>
      </section>
    </main>
  )
}
