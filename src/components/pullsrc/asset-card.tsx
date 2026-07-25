"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Copy, Download, ThumbsDown, ThumbsUp } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { CategoryIcon } from "@/components/pullsrc/category-icon"
import type { Asset } from "@/lib/pullsrc/types"

// Aspect ratio instead of a fixed height — scales with whatever width the
// grid column actually has, so mobile's narrower 2-col cards stay
// proportionate instead of towering over their own width.
const PREVIEW_ASPECT = "aspect-[4/3]"
const PREVIEW_SHAPE = "rounded-xl"

function downloadHref(url: string, name: string) {
  return `/api/download?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`
}

function copyToClipboard(value: string, message: string) {
  navigator.clipboard.writeText(value)
  toast.success(message)
}

export function AssetCard({
  asset,
  selected,
  onToggleSelect,
  logoVote,
  onLogoVote,
}: {
  asset: Asset
  selected: boolean
  onToggleSelect: (checked: boolean) => void
  logoVote?: "up" | "down" | null
  onLogoVote?: (vote: "up" | "down") => void
}) {
  const isColor = asset.category === "colors"
  const isVideo = asset.category === "video"
  const isLogo = asset.category === "logo"
  const isDrm = isVideo && asset.drmProtected
  const isStreamingOnly = isVideo && asset.wasStreaming
  const selectable = !isDrm && !isStreamingOnly
  const hasUrl = "url" in asset

  const metaParts = [asset.fileType, asset.size !== "—" ? asset.size : null].filter(Boolean)
  if (asset.category === "fonts") {
    metaParts.push(`${asset.weights.length} weight${asset.weights.length === 1 ? "" : "s"}`)
  }
  if (isDrm) metaParts.push("DRM")
  else if (isStreamingOnly) metaParts.push("streaming only")

  const copyValue = isColor ? asset.hex : hasUrl ? asset.url : null
  const copyMessage = isColor ? "Hex code copied" : "Asset URL copied"

  return (
    <Card className="relative gap-0 p-0">
      {selectable && (
        <Checkbox
          checked={selected}
          onCheckedChange={(checked) => onToggleSelect(checked === true)}
          aria-label={`Select ${asset.name}`}
          className="absolute top-4 left-4 z-10 bg-background/80 backdrop-blur"
        />
      )}

      {isColor ? (
        <AssetPreview asset={asset} />
      ) : (
        <div className="p-2">
          <AssetPreview asset={asset} />
        </div>
      )}

      <CardContent className="flex flex-1 items-center gap-2 px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-sm">
          <span className="font-medium">{asset.name}</span>
          {metaParts.length > 0 && (
            <span className="text-muted-foreground"> · {metaParts.join(" · ")}</span>
          )}
        </p>

        <div className="flex shrink-0 items-center gap-0.5">
          {isLogo && (
            <>
              <Button
                type="button"
                variant={logoVote === "up" ? "secondary" : "ghost"}
                size="icon-xs"
                aria-label="This is the logo"
                onClick={() => onLogoVote?.("up")}
              >
                <ThumbsUp />
              </Button>
              <Button
                type="button"
                variant={logoVote === "down" ? "secondary" : "ghost"}
                size="icon-xs"
                aria-label="This is not the logo"
                onClick={() => onLogoVote?.("down")}
              >
                <ThumbsDown />
              </Button>
            </>
          )}
          {copyValue && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={isColor ? "Copy hex code" : "Copy asset url"}
              onClick={() => copyToClipboard(copyValue, copyMessage)}
            >
              <Copy />
            </Button>
          )}
          {selectable && hasUrl && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Download ${asset.name}`}
              render={
                <a href={downloadHref(asset.url, asset.name)} download={asset.name} />
              }
            >
              <Download />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function AssetPreview({ asset }: { asset: Asset }) {
  const fontStyleId = useId()
  const [imageFailed, setImageFailed] = useState(false)

  if (asset.category === "colors") {
    return <div className={`${PREVIEW_ASPECT} w-full`} style={{ background: asset.hex }} />
  }

  if (asset.category === "video") {
    if (asset.wasStreaming) {
      return (
        <div className={`flex ${PREVIEW_ASPECT} ${PREVIEW_SHAPE} w-full items-center justify-center bg-muted`}>
          <CategoryIcon category="video" className="size-7 text-muted-foreground" />
        </div>
      )
    }
    return (
      <video
        src={asset.url}
        muted
        controls
        preload="metadata"
        className={`${PREVIEW_ASPECT} ${PREVIEW_SHAPE} w-full bg-emerald-50 object-contain`}
      />
    )
  }

  if (asset.category === "audio") {
    return (
      <div className={`flex ${PREVIEW_ASPECT} ${PREVIEW_SHAPE} w-full flex-col items-center justify-center gap-3 bg-muted px-4`}>
        <CategoryIcon category="audio" className="size-8 text-muted-foreground" />
        <audio src={asset.url} controls preload="metadata" className="h-8 w-full max-w-64" />
      </div>
    )
  }

  if (asset.category === "model3d") {
    return <Model3DPreview url={asset.url} name={asset.name} />
  }

  if (asset.category === "fonts") {
    const familyName = `pullsrc-font-${fontStyleId.replace(/[:]/g, "")}`
    return (
      <div className={`flex ${PREVIEW_ASPECT} ${PREVIEW_SHAPE} w-full items-center justify-center bg-muted px-3`}>
        <style>{`@font-face { font-family: "${familyName}"; src: url("${asset.url}"); font-display: swap; }`}</style>
        <p
          className="max-w-full truncate text-4xl text-foreground"
          style={{ fontFamily: `"${familyName}", var(--font-sans)` }}
        >
          {asset.fontFamily}
        </p>
      </div>
    )
  }

  if (imageFailed) {
    return (
      <div className={`flex ${PREVIEW_ASPECT} ${PREVIEW_SHAPE} w-full items-center justify-center bg-muted`}>
        <CategoryIcon category={asset.category} className="size-7 text-muted-foreground" />
      </div>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={asset.url}
      alt={asset.name}
      loading="lazy"
      onError={() => setImageFailed(true)}
      className={`${PREVIEW_ASPECT} ${PREVIEW_SHAPE} w-full bg-muted object-contain`}
    />
  )
}

function Model3DPreview({ url, name }: { url: string; name: string }) {
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const ref = useRef<HTMLElement | null>(null)

  useEffect(() => {
    let cancelled = false
    import("@google/model-viewer")
      .then(() => {
        if (!cancelled) setReady(true)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el || !ready) return
    const onError = () => setFailed(true)
    el.addEventListener("error", onError)
    return () => el.removeEventListener("error", onError)
  }, [ready])

  if (failed || !ready) {
    return (
      <div className={`flex ${PREVIEW_ASPECT} ${PREVIEW_SHAPE} w-full items-center justify-center bg-muted`}>
        <CategoryIcon category="model3d" className="size-7 text-muted-foreground" />
      </div>
    )
  }

  return (
    <model-viewer
      ref={ref}
      src={url}
      alt={name}
      auto-rotate
      camera-controls
      disable-zoom
      touch-action="pan-y"
      shadow-intensity="1"
      className={`${PREVIEW_ASPECT} ${PREVIEW_SHAPE} w-full bg-muted`}
    />
  )
}
