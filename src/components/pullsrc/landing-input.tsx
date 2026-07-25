"use client"

import { ArrowRight, Link2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function LandingInput({
  value,
  onChange,
  onSubmit,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
}) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col items-center text-center">
      <div className="flex flex-col items-center text-center">
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

        <form
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit()
          }}
          className="mt-7 w-full max-w-xl "
        >
          <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-[0_20px_60px_rgba(15,106,91,0.14)] transition-shadow focus-within:ring-3 focus-within:ring-ring/25">
            <Link2 className="ml-2 size-4 shrink-0 text-muted-foreground" />
            <Input
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder="https://example.com/page"
              aria-label="Page url"
              className="h-14 border-0 bg-transparent px-1 text-base text-foreground shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-0"
            />
            <Button
              type="submit"
              size="lg"
              className="h-14 shrink-0 px-6 shadow-[0_14px_26px_rgba(15,106,91,0.2)]"
            >
              Scan
              <ArrowRight />
            </Button>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Enter a page URL, not just a domain — e.g.{" "}
            <span className="font-mono text-foreground">
              acme.com/product-page
            </span>
            .
          </p>
        </form>
      </div>
    </div>
  )
}
