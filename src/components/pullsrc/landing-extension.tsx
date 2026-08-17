import { CircleCheck, Puzzle } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  EXTENSION_POINTS,
  EXTENSION_STATUS,
  EXTENSION_URL,
} from "@/lib/pullsrc/seo"

export function LandingExtension() {
  return (
    <section
      aria-labelledby="extension"
      className="mx-auto w-full max-w-5xl px-4 pb-20"
    >
      <div className="rounded-3xl border border-border bg-card p-8 shadow-sm sm:p-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
              <CircleCheck className="size-3" aria-hidden />
              {EXTENSION_STATUS}
            </span>
            <h2
              id="extension"
              className="mt-4 font-heading text-3xl uppercase tracking-normal text-foreground sm:text-4xl"
            >
              The browser extension
            </h2>
            <p className="mt-3 text-base leading-7 text-muted-foreground">
              The website can only reach pages a logged-out visitor can. The
              PullSRC Chrome extension scans the tab you already have open, so
              it pulls assets from anything you can see — including pages behind
              a login. It&apos;s free, it&apos;s on the Chrome Web Store now,
              and it gives the best results of the two.
            </p>
          </div>

          <div className="shrink-0">
            {EXTENSION_URL ? (
              <Button
                size="lg"
                className="h-12 px-5 shadow-[0_14px_26px_rgba(15,106,91,0.2)]"
                render={
                  <a href={EXTENSION_URL} target="_blank" rel="noreferrer" />
                }
              >
                <Puzzle />
                Add to Chrome — free
              </Button>
            ) : (
              <Button
                size="lg"
                variant="outline"
                className="h-12 cursor-not-allowed px-5"
                disabled
              >
                <Puzzle />
                Chrome Web Store listing unavailable
              </Button>
            )}
          </div>
        </div>

        <dl className="mt-8 grid gap-6 border-t border-border pt-8 sm:grid-cols-3">
          {EXTENSION_POINTS.map((point) => (
            <div key={point.title}>
              <dt className="text-base font-medium text-foreground">
                {point.title}
              </dt>
              <dd className="mt-2 text-sm leading-6 text-muted-foreground">
                {point.body}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
