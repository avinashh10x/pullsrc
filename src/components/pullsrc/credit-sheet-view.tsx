"use client"

import { ArrowLeft, Copy } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { CategoryIcon } from "@/components/pullsrc/category-icon"
import { buildCreditSheet, creditLine, LEGAL_NOTICE } from "@/lib/pullsrc/credit"
import type { ScanResult } from "@/lib/pullsrc/types"

export function CreditSheetView({
  result,
  onBack,
}: {
  result: ScanResult
  onBack: () => void
}) {
  const copyAll = () => {
    navigator.clipboard.writeText(buildCreditSheet(result))
    toast.success("Credit sheet copied", {
      description: "Paste it under your article as one block.",
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft />
          Back to results
        </Button>
        <Button size="sm" onClick={copyAll}>
          <Copy />
          Copy all
        </Button>
      </div>

      <div className="rounded-xl bg-neutral-50 p-8 text-neutral-900 shadow-lg sm:p-10">
        <p className="text-xs tracking-wide text-neutral-500 uppercase">
          Source credits
        </p>
        <h1 className="mt-1 text-xl font-semibold text-balance">
          {result.pageTitle}
        </h1>
        <p className="mt-1 font-mono text-xs text-neutral-500">
          {result.pageUrl} · scanned {result.scanDate}
        </p>

        <div className="mt-6 rounded-lg bg-amber-50 p-3.5 text-xs text-amber-900 ring-1 ring-amber-200">
          <p className="font-semibold">Before you use anything below</p>
          <p className="mt-1 whitespace-pre-line text-amber-800">{LEGAL_NOTICE}</p>
        </div>

        <div className="mt-6 border-t border-neutral-200" />

        {result.assets.length === 0 ? (
          <p className="mt-6 text-sm text-neutral-500">
            No assets were found on this page, so there is nothing to credit.
          </p>
        ) : (
          <ul className="mt-6 space-y-3 font-mono text-sm">
            {result.assets.map((asset) => (
              <li key={asset.id} className="flex gap-2.5">
                <CategoryIcon
                  category={asset.category}
                  className="mt-0.5 size-3.5 shrink-0 text-neutral-400"
                />
                <span className="text-neutral-700">{creditLine(asset)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
