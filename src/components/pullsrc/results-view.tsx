"use client"

import { useState } from "react"
import { FileSearch, FileStack, Loader2, Package, ReceiptText, RotateCcw } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AssetCard } from "@/components/pullsrc/asset-card"
import { BulkActionBar } from "@/components/pullsrc/bulk-action-bar"
import { CategoryIcon } from "@/components/pullsrc/category-icon"
import { cn } from "@/lib/utils"
import { buildExportZip, triggerBlobDownload } from "@/lib/pullsrc/zip"
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  type Asset,
  type AssetCategory,
  type ScanResult,
} from "@/lib/pullsrc/types"

type TabValue = "all" | AssetCategory

const SIDEBAR_BADGE_CLASS =
  "h-7 min-w-8 rounded-full bg-secondary px-2 text-sm font-semibold text-secondary-foreground"

const MOBILE_TAB_CLASS =
  "flex shrink-0 items-center gap-1 rounded-full border px-2 py-1.5 text-sm whitespace-nowrap transition-colors"

// A pill-shaped Badge inside an already pill-shaped tab is ~32px of chrome
// per tab — enough to push six tabs off a phone screen on its own.
const MOBILE_TAB_COUNT_CLASS = "text-xs tabular-nums opacity-70"

const SIDEBAR_TRIGGER_CLASS =
  "h-12 gap-3 rounded-[10px] px-4 py-2 text-base font-semibold data-active:border-primary data-active:bg-accent data-active:text-accent-foreground data-active:shadow-[0_2px_0_rgba(15,106,91,0.16)] focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary/25"

export function ResultsView({
  result,
  scanning,
  pendingCategories,
  onNewScan,
  onOpenCreditSheet,
}: {
  result: ScanResult
  scanning: boolean
  pendingCategories: Set<AssetCategory>
  onNewScan: () => void
  onOpenCreditSheet: () => void
}) {
  const [activeTab, setActiveTab] = useState<TabValue>("all")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [logoVotes, setLogoVotes] = useState<Record<string, "up" | "down">>(
    {}
  )

  // Empty while streaming just means nothing's arrived yet, not that there's nothing to find.
  if (!scanning && result.assets.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center px-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <FileSearch className="size-5" />
        </div>
        <div className="mt-4 space-y-1.5">
          <h2 className="text-lg font-medium">No assets found</h2>
          <p className="text-sm text-balance text-muted-foreground">
            PullSRC rendered this page but didn&apos;t find any images,
            fonts, colors, video, sound, or 3D models worth pulling. Some
            pages genuinely have nothing to grab.
          </p>
        </div>
        <div className="mt-3 max-w-full truncate rounded-md bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground">
          {result.pageUrl}
        </div>
        <Button onClick={onNewScan} className="mt-6">
          <RotateCcw />
          Try another url
        </Button>
      </div>
    )
  }

  const counts = { all: result.assets.length } as Record<TabValue, number>
  for (const category of CATEGORY_ORDER) counts[category] = 0
  for (const asset of result.assets) counts[asset.category] += 1

  // stays visible while pending even at zero hits; settles out once done
  const visibleCategories = CATEGORY_ORDER.filter(
    (category) => counts[category] > 0 || pendingCategories.has(category)
  )

  const visibleAssets: Asset[] =
    activeTab === "all"
      ? result.assets
      : result.assets.filter((asset) => asset.category === activeTab)

  const isActiveTabPending = activeTab !== "all" && pendingCategories.has(activeTab)

  const toggleSelect = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const selectedAssets = result.assets.filter((asset) => selected.has(asset.id))

  const downloadAllAsZip = () => {
    toast.promise(
      buildExportZip(result, result.assets).then((blob) =>
        triggerBlobDownload(blob, "pullsrc-export.zip")
      ),
      {
        loading: "Zipping everything…",
        success: "Download ready",
        error: "Couldn't build that zip",
      }
    )
  }

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pb-8",
        // The bar is fixed, so the last row of cards needs room or it sits
        // underneath it.
        selectedAssets.length > 0 && "pb-28",
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {result.sourceDomain} · scanned {result.scanDate}
            {scanning && (
              <span className="inline-flex items-center gap-1 text-foreground/70">
                <Loader2 className="size-3 animate-spin" />
                still finding assets…
              </span>
            )}
          </p>
          <h1 className="truncate text-xl font-semibold">
            {result.pageTitle}
          </h1>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {result.pageUrl}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onNewScan}>
            <RotateCcw />
            New scan
          </Button>
          <Button variant="outline" size="sm" onClick={onOpenCreditSheet}>
            <ReceiptText />
            Credit sheet
          </Button>
          <Button size="sm" onClick={downloadAllAsZip}>
            <Package />
            Download all as zip
          </Button>
        </div>
      </div>

      {/* Stacked (mobile) this is a flex column, so `items-start` sized panels
          to their content — the colors grid, whose labels are just a hex code,
          collapsed to ~80% width. Only the lg row layout wants start
          alignment, and there it means "don't stretch the sticky sidebar to
          full height". */}
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as TabValue)}
        orientation="vertical"
        className="flex-col items-stretch gap-4 lg:flex-row lg:items-start lg:gap-8"
      >
        {/* Mobile: compact strip. The vertical sidebar below stacks into a
            tall full-width list at this width, so it's hidden here instead
            and swapped in at lg. Labels collapse to bare icons on phones —
            six labelled pills overflow a 393px screen — but the active tab
            keeps its label so the current category is always readable. */}
        <div className="-mx-4 flex w-[calc(100%+2rem)] gap-1.5 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] scrollbar-none [&::-webkit-scrollbar]:hidden lg:hidden">
          <button
            type="button"
            onClick={() => setActiveTab("all")}
            aria-label={`All (${counts.all})`}
            className={cn(
              MOBILE_TAB_CLASS,
              activeTab === "all"
                ? "border-primary bg-primary text-primary-foreground shadow-sm shadow-primary/15"
                : "border-border text-muted-foreground"
            )}
          >
            <FileStack className="size-3.5" />
            <span className={cn(activeTab !== "all" && "hidden sm:inline")}>All</span>
            <span className={MOBILE_TAB_COUNT_CLASS}>{counts.all}</span>
          </button>
          {visibleCategories.map((category) => {
            const isPending = pendingCategories.has(category)
            const count = counts[category]
            const isActive = activeTab === category
            return (
              <button
                key={category}
                type="button"
                onClick={() => setActiveTab(category)}
                aria-label={`${CATEGORY_LABEL[category]} (${count})`}
                className={cn(
                  MOBILE_TAB_CLASS,
                  isActive
                    ? "border-primary bg-primary text-primary-foreground shadow-sm shadow-primary/15"
                    : "border-border text-muted-foreground"
                )}
              >
                <CategoryIcon category={category} className="size-3.5" />
                <span className={cn(!isActive && "hidden sm:inline")}>
                  {CATEGORY_LABEL[category]}
                </span>
                {isPending && count === 0 ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <span className={MOBILE_TAB_COUNT_CLASS}>{count}</span>
                )}
              </button>
            )
          })}
        </div>

        <TabsList className="hidden w-full shrink-0 gap-2 rounded-[14px] border border-border bg-white p-2.5 shadow-[0_8px_22px_rgba(15,106,91,0.08)] lg:flex lg:sticky lg:top-6 lg:w-64">
          <TabsTrigger
            value="all"
            className={SIDEBAR_TRIGGER_CLASS}
          >
            <FileStack className="size-4" />
            All
            <span className="ml-auto flex items-center gap-1">
              <Badge variant="secondary" className={SIDEBAR_BADGE_CLASS}>
                {counts.all}
              </Badge>
              {scanning && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
            </span>
          </TabsTrigger>
          {visibleCategories.map((category) => {
            const isPending = pendingCategories.has(category)
            const count = counts[category]
            return (
              <TabsTrigger
                key={category}
                value={category}
                className={SIDEBAR_TRIGGER_CLASS}
              >
                <CategoryIcon category={category} className="size-4" />
                {CATEGORY_LABEL[category]}
                {isPending && count === 0 ? (
                  <Loader2 className="ml-auto size-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <span className="ml-auto flex items-center gap-1">
                    <Badge variant="secondary" className={SIDEBAR_BADGE_CLASS}>
                      {count}
                    </Badge>
                    {isPending && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
                  </span>
                )}
              </TabsTrigger>
            )
          })}
        </TabsList>

        <TabsContent value={activeTab} className="min-w-0">
          {visibleAssets.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {isActiveTabPending ? "Still looking…" : "Nothing in this category."}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
              {visibleAssets.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  selected={selected.has(asset.id)}
                  onToggleSelect={(checked) =>
                    toggleSelect(asset.id, checked)
                  }
                  logoVote={logoVotes[asset.id] ?? null}
                  onLogoVote={(vote) =>
                    setLogoVotes((current) => ({
                      ...current,
                      [asset.id]: vote,
                    }))
                  }
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <BulkActionBar
        result={result}
        selectedAssets={selectedAssets}
        onClear={() => setSelected(new Set())}
      />
    </div>
  )
}
