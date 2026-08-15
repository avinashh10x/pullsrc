import { LandingInput } from "@/components/pullsrc/landing-input"

// Server-rendered so the h1, the sub-copy, and the badge are in the initial
// HTML for crawlers that don't execute JavaScript. Only the input itself is a
// client component.
export function LandingHero() {
  return (
    <section className="flex w-full flex-col items-center justify-center bg-[radial-gradient(circle_at_50%_18%,rgba(15,106,91,0.16),transparent_34%),linear-gradient(180deg,#f7fffb_0%,#eef8f3_52%,#ffffff_100%)] px-4 py-16 min-h-[calc(100svh-4rem)]">
      <div className="mx-auto flex w-full max-w-4xl flex-col items-center text-center">
        <div className="inline-flex items-center overflow-hidden rounded-xl border border-border bg-white text-sm shadow-sm px-1">
          <span className="rounded-lg bg-primary px-2 py-1 font-heading text-sm text-primary-foreground">
            PullSRC
          </span>
          <span className="px-2 py-2 font-medium text-primary">
            Every asset, one clean export
          </span>
        </div>

        <div className="mt-5 space-y-3">
          <h1 className="max-w-3xl font-heading text-5xl uppercase tracking-normal text-foreground sm:text-6xl">
            Pull every asset <br /> Skip the DevTools
          </h1>
          <p className="mx-auto max-w-2xl text-balance text-base leading-7 text-muted-foreground sm:text-lg">
            PullSRC extracts images, logos, fonts, colors, videos, audio, and
            more from any webpage. Just paste a URL and scan.
          </p>
        </div>

        <LandingInput />
      </div>
    </section>
  )
}
