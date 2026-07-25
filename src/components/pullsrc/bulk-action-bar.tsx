"use client"

import { Download, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { buildExportZip, triggerBlobDownload } from "@/lib/pullsrc/zip"
import type { Asset, ScanResult } from "@/lib/pullsrc/types"

export function BulkActionBar({
  result,
  selectedAssets,
  onClear,
}: {
  result: ScanResult
  selectedAssets: Asset[]
  onClear: () => void
}) {
  if (selectedAssets.length === 0) return null

  const downloadSelected = () => {
    toast.promise(
      buildExportZip(result, selectedAssets).then((blob) =>
        triggerBlobDownload(blob, "pullsrc-export.zip")
      ),
      {
        loading: `Zipping ${selectedAssets.length} asset${selectedAssets.length === 1 ? "" : "s"}…`,
        success: "Download ready",
        error: "Couldn't build that zip",
      }
    )
  }

  return (
    <div className="pointer-events-none sticky bottom-4 z-20 flex justify-center px-4">
      <Card className="pointer-events-auto flex-row items-center gap-3 p-2 pl-4 shadow-lg ring-foreground/15">
        <span className="text-sm font-medium tabular-nums">
          {selectedAssets.length} selected
        </span>
        <Button variant="ghost" size="sm" onClick={onClear}>
          <X />
          Clear
        </Button>
        <Button size="sm" onClick={downloadSelected}>
          <Download />
          Download selected
        </Button>
      </Card>
    </div>
  )
}
