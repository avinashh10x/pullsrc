"use client"

import { useEffect, useId, useRef, useState } from "react"
import { ChevronDown, Copy, Download, Pause, Play, ThumbsDown, ThumbsUp, Volume2, VolumeX } from "lucide-react"
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

function downloadHref(url: string, name: string, referer: string) {
  return `/api/download?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}&referer=${encodeURIComponent(referer)}`
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
  const isLogo = asset.category === "logo"
  const isDrm =
    (asset.category === "video" || asset.category === "audio") && asset.drmProtected
  const isStreamingOnly =
    (asset.category === "video" || asset.category === "audio") && asset.wasStreaming
  const selectable = !isDrm && !isStreamingOnly
  const hasUrl = "url" in asset
  const variants = "variants" in asset ? asset.variants ?? [] : []

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

      <div className="p-2">
        <AssetPreview asset={asset} />
      </div>

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
                <a href={downloadHref(asset.url, asset.name, asset.credit.originalUrl)} download={asset.name} />
              }
            >
              <Download />
            </Button>
          )}
          {variants.length > 1 && (
            <details className="relative">
              <summary
                aria-label={`Show ${variants.length} download variants for ${asset.name}`}
                className="flex size-6 cursor-pointer list-none items-center justify-center rounded-[min(var(--radius-md),10px)] hover:bg-muted [&::-webkit-details-marker]:hidden"
              >
                <ChevronDown className="size-3" />
              </summary>
              <div className="absolute top-7 right-0 z-20 w-56 rounded-lg border border-border bg-background p-1.5 shadow-lg">
                <p className="px-2 py-1 text-xs text-muted-foreground">Download variants</p>
                {variants.map((variant) =>
                  variant.wasStreaming || variant.drmProtected ? (
                    <p key={variant.url} className="flex justify-between gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                      <span className="truncate">{variant.name}</span>
                      <span>{variant.drmProtected ? "DRM" : "stream"}</span>
                    </p>
                  ) : (
                    <a
                      key={variant.url}
                      href={downloadHref(variant.url, variant.name, asset.credit.originalUrl)}
                      download={variant.name}
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted"
                    >
                      <span className="truncate">{variant.name}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {variant.recommended ? "Best" : variant.fileType}
                      </span>
                    </a>
                  )
                )}
              </div>
            </details>
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
    return (
      <div className={`${PREVIEW_ASPECT} ${PREVIEW_SHAPE} w-full`} style={{ background: asset.hex }} />
    )
  }

  if (asset.category === "video") {
    if (asset.wasStreaming) {
      return (
        <div className={`flex ${PREVIEW_ASPECT} ${PREVIEW_SHAPE} w-full items-center justify-center bg-muted`}>
          <CategoryIcon category="video" className="size-7 text-muted-foreground" />
        </div>
      )
    }
    return <VideoPreview url={asset.url} />
  }

  if (asset.category === "audio") {
    if (asset.wasStreaming) {
      return (
        <div className={`flex ${PREVIEW_ASPECT} ${PREVIEW_SHAPE} w-full items-center justify-center bg-muted`}>
          <CategoryIcon category="audio" className="size-8 text-muted-foreground" />
        </div>
      )
    }
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

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0))
  const secs = String(total % 60).padStart(2, "0")
  const mins = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  return hours > 0 ? `${hours}:${String(mins).padStart(2, "0")}:${secs}` : `${mins}:${secs}`
}

// Native <video controls> always counts up from 0:00 and the browser owns that
// chrome, so showing time remaining means replacing the control bar outright.
function VideoPreview({ url }: { url: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(true)
  const [duration, setDuration] = useState(0)
  const [elapsed, setElapsed] = useState(0)

  const seekable = duration > 0
  const progress = seekable ? Math.min(elapsed / duration, 1) * 100 : 0

  function togglePlay() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play().catch(() => {})
    else video.pause()
  }

  function toggleMute() {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    setMuted(video.muted)
  }

  function seek(seconds: number) {
    const video = videoRef.current
    if (!video || !seekable) return
    video.currentTime = seconds
    setElapsed(seconds)
  }

  return (
    <div className={`relative ${PREVIEW_ASPECT} ${PREVIEW_SHAPE} w-full overflow-hidden bg-emerald-50`}>
      <video
        ref={videoRef}
        src={url}
        muted
        playsInline
        preload="metadata"
        onClick={togglePlay}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)}
        className="size-full cursor-pointer object-contain"
      />

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-linear-to-t from-black/70 to-transparent px-1.5 pt-5 pb-1.5">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
          className="flex size-5 shrink-0 items-center justify-center rounded text-white/90 hover:text-white"
        >
          {playing ? <Pause className="size-3 fill-current" /> : <Play className="size-3 fill-current" />}
        </button>

        <input
          type="range"
          min={0}
          max={seekable ? duration : 0}
          step={0.05}
          value={seekable ? Math.min(elapsed, duration) : 0}
          disabled={!seekable}
          onChange={(event) => seek(Number(event.target.value))}
          aria-label="Seek"
          style={{
            background: `linear-gradient(to right, white ${progress}%, rgb(255 255 255 / 0.3) ${progress}%)`,
          }}
          className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full [&::-moz-range-thumb]:size-2.5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:size-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
        />

        {/* Time left, not time played — ticks down toward 0:00. */}
        <span className="shrink-0 font-mono text-[0.65rem] tabular-nums text-white/90">
          {seekable ? `-${formatClock(duration - elapsed)}` : "--:--"}
        </span>

        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? "Unmute" : "Mute"}
          className="flex size-5 shrink-0 items-center justify-center rounded text-white/90 hover:text-white"
        >
          {muted ? <VolumeX className="size-3" /> : <Volume2 className="size-3" />}
        </button>
      </div>
    </div>
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
