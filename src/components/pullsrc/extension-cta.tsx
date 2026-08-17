import { Puzzle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { EXTENSION_URL } from "@/lib/pullsrc/seo"

export function ExtensionCta({ variant }: { variant: "hero" | "results" }) {
  if (!EXTENSION_URL) return null

  if (variant === "hero") {
    return (
      <a
        href={EXTENSION_URL}
        target="_blank"
        rel="noreferrer"
        className="mt-5 inline-flex items-center gap-2 rounded-full border border-border bg-white/70 px-4 py-2 text-sm text-muted-foreground shadow-sm transition hover:border-primary/40 hover:text-foreground"
      >
        <Puzzle className="size-4 text-primary" aria-hidden />
        <span>
          <span className="font-medium text-foreground">Get the extension</span>{" "}
          for best results — it reads pages behind a login
        </span>
      </a>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">
          Missing something from this page?
        </span>{" "}
        The Chrome extension scans the tab you have open — logged in, behind
        paywalls, anywhere you can already see.
      </p>
      <Button
        size="sm"
        className="shrink-0"
        render={<a href={EXTENSION_URL} target="_blank" rel="noreferrer" />}
      >
        <Puzzle />
        Get extension for best results
      </Button>
    </div>
  )
}
