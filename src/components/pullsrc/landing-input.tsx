"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, Link2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { normalizeUrl } from "@/lib/pullsrc/url"

export function LandingInput() {
  const router = useRouter()
  const [url, setUrl] = useState("")

  const handleSubmit = () => {
    if (!url.trim()) return
    router.push(`/scan?url=${encodeURIComponent(normalizeUrl(url))}`)
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        handleSubmit()
      }}
      className="mt-7 w-full max-w-xl "
    >
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-[0_20px_60px_rgba(15,106,91,0.14)] transition-shadow focus-within:ring-3 focus-within:ring-ring/25">
        <Link2 className="ml-2 size-4 shrink-0 text-muted-foreground" />
        <Input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
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
        <span className="font-mono text-foreground">acme.com/product-page</span>
        .
      </p>
    </form>
  )
}
