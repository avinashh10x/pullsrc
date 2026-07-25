"use client"

import { Loader2 } from "lucide-react"

import { Card } from "@/components/ui/card"
import { CategoryIcon } from "@/components/pullsrc/category-icon"
import { CATEGORY_LABEL, CATEGORY_ORDER } from "@/lib/pullsrc/types"

export function ScanningView({ url }: { url: string }) {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-6 px-4 text-center">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Scanning{" "}
        <span className="max-w-64 truncate font-mono text-foreground">
          {url}
        </span>
      </div>

      <Card className="w-full p-1">
        <ul className="divide-y divide-border">
          {CATEGORY_ORDER.map((category, index) => (
            <li
              key={category}
              className="flex items-center gap-3 px-3 py-2.5"
              style={{ animationDelay: `${index * 120}ms` }}
            >
              <div className="flex size-7 shrink-0 animate-pulse items-center justify-center rounded-md bg-muted text-muted-foreground">
                <CategoryIcon category={category} className="size-4" />
              </div>
              <span className="flex-1 text-left text-sm font-medium text-muted-foreground">
                {CATEGORY_LABEL[category]}
              </span>
              <Loader2 className="size-4 animate-spin text-muted-foreground/50" />
            </li>
          ))}
        </ul>
      </Card>

      <p className="text-xs text-muted-foreground">
        Rendering the page, reading real images, fonts, and colors off it —
        this takes a few seconds.
      </p>
    </div>
  )
}
