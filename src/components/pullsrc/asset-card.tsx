"use client"

import { useEffect, useId, useRef, useState } from "react"
import { ChevronDown, Copy, Download, Pause, Play, ThumbsDown, ThumbsUp, Volume2, VolumeX } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { CategoryIcon } from "@/components/pullsrc/category-icon"
import { assetDownloads, downloadHref, variantHref } from "@/lib/pullsrc/download"
import { canRetryProxied, modelExtension, modelRenderer } from "@/lib/pullsrc/model3d"
import type { Asset, MediaVariant } from "@/lib/pullsrc/types"

// Aspect ratio instead of a fixed height — scales with whatever width the
// grid column actually has, so mobile's narrower 2-col cards stay
// proportionate instead of towering over their own width.
const PREVIEW_ASPECT = "aspect-[4/3]"
const PREVIEW_SHAPE = "rounded-xl"

function copyToClipboard(value: string, message: string) {
  navigator.clipboard.writeText(value)
  toast.success(message)
}

// "1080p" means nothing to most people; "Full HD" does. Ordered high to low
// and matched on the first threshold the height clears.
const QUALITY_NAMES: Array<[number, string]> = [
  [2160, "4K Ultra HD"],
  [1440, "2K"],
  [1080, "Full HD"],
  [720, "HD"],
  [480, "Standard"],
  [0, "Low quality"],
]

// A filename tells the user nothing about which download to pick. What they
// need is how good it looks and how big it is.
function variantLabel(variant: MediaVariant): { title: string; detail: string } {
  if (variant.drmProtected) return { title: "Protected", detail: "can't download" }
  if (variant.wasStreaming) return { title: "Stream", detail: "assembled on download" }
  if (/^original$/i.test(variant.quality ?? "")) {
    return { title: "Original", detail: "full quality" }
  }

  const height = Number(/^(\d{3,4})p$/i.exec(variant.quality ?? "")?.[1] ?? 0)
  if (height) {
    return {
      title: QUALITY_NAMES.find(([min]) => height >= min)?.[1] ?? "Low quality",
      detail: variant.quality ?? "",
    }
  }
  return { title: variant.fileType, detail: "" }
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
  // Streams used to be excluded here. They're assembled into a real file by
  // /api/stream now, so only DRM is genuinely out of reach.
  const selectable = !isDrm
  const hasUrl = "url" in asset
  const variants = "variants" in asset ? asset.variants ?? [] : []
  const downloads = assetDownloads(asset, asset.credit.originalUrl)

  const metaParts = [asset.fileType, asset.size !== "—" ? asset.size : null].filter(Boolean)
  if (asset.category === "fonts") {
    metaParts.push(`${asset.weights.length} weight${asset.weights.length === 1 ? "" : "s"}`)
  }
  if (isDrm) metaParts.push("DRM")
  else if (isStreamingOnly) metaParts.push("stream")
  if (asset.category === "video" && asset.audioUrl) metaParts.push("video + audio")

  const copyValue = isColor ? asset.hex : hasUrl ? asset.url : null
  const copyMessage = isColor ? "Hex code copied" : "Asset URL copied"

  // The variants popover anchors to the whole card rather than its little
  // chevron, so it lines up flush with the card edges instead of hanging off
  // one corner.
  const cardRef = useRef<HTMLDivElement>(null)

  return (
    <Card ref={cardRef} className="relative gap-0 p-0">
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
          {selectable &&
            hasUrl &&
            downloads.map((download) => (
              <Button
                key={download.href}
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={
                  downloads.length > 1
                    ? `Download ${download.label} for ${asset.name}`
                    : `Download ${asset.name}`
                }
                render={<a href={download.href} download={download.filename} />}
              >
                {download.label === "audio" ? <Volume2 /> : <Download />}
              </Button>
            ))}
          {variants.length > 1 && (
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Show ${variants.length} download variants for ${asset.name}`}
                  />
                }
              >
                <ChevronDown />
              </PopoverTrigger>
              {/* Exactly the card's width at every breakpoint — a min-width
                  would exceed the card on phones and get collision-shifted
                  off its edges. */}
              <PopoverContent
                anchor={cardRef}
                align="center"
                className="w-(--anchor-width)"
              >
                <p className="px-2 pt-0.5 pb-1.5 text-xs text-muted-foreground">
                  Choose a quality to download
                </p>
                {variants.map((variant) => {
                  const { title, detail } = variantLabel(variant)
                  const undownloadable = variant.drmProtected

                  const row = (
                    <>
                      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                        <span className="truncate font-medium">{title}</span>
                        {detail && (
                          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                            {detail}
                          </span>
                        )}
                        {variant.recommended && (
                          <span className="shrink-0 rounded bg-primary/10 px-1 py-px text-[0.65rem] font-medium text-primary">
                            Best
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {variant.size}
                      </span>
                    </>
                  )

                  return undownloadable ? (
                    <p
                      key={variant.url}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm text-muted-foreground"
                    >
                      {row}
                    </p>
                  ) : (
                    <PopoverClose
                      key={variant.url}
                      render={
                        <a
                          href={variantHref(variant, asset.credit.originalUrl)}
                          download={variant.name}
                        />
                      }
                      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                    >
                      {row}
                    </PopoverClose>
                  )
                })}
              </PopoverContent>
            </Popover>
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
    return (
      <Model3DPreview
        url={asset.url}
        name={asset.name}
        fileType={asset.fileType}
        referer={asset.credit.originalUrl}
      />
    )
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

function Model3DFallback({ label }: { label?: string }) {
  return (
    <div
      className={`flex ${PREVIEW_ASPECT} ${PREVIEW_SHAPE} w-full flex-col items-center justify-center gap-1.5 bg-muted`}
    >
      <CategoryIcon category="model3d" className="size-7 text-muted-foreground" />
      {label && <span className="text-[0.65rem] text-muted-foreground">{label}</span>}
    </div>
  )
}

function Model3DPreview({
  url,
  name,
  fileType,
  referer,
}: {
  url: string
  name: string
  fileType: string
  referer: string
}) {
  const renderer = modelRenderer(url, fileType)

  if (renderer === "gltf") return <GltfPreview url={url} name={name} fileType={fileType} referer={referer} />
  if (renderer === "three") return <ThreePreview url={url} fileType={fileType} referer={referer} />
  return <Model3DFallback label="No preview for this format" />
}

// Direct first, since a .gltf resolves its .bin and textures relative to where
// it was fetched from. The proxy is the retry for CORS and referer-locked CDNs.
function useProxyRetry(url: string, name: string, fileType: string, referer: string) {
  const [proxied, setProxied] = useState(false)
  const canRetry = canRetryProxied(url, fileType)

  const src = proxied ? downloadHref({ url, name }, referer) : url
  const retry = () => {
    if (!canRetry || proxied) return false
    setProxied(true)
    return true
  }
  return { src, retry, proxied }
}

function GltfPreview({
  url,
  name,
  fileType,
  referer,
}: {
  url: string
  name: string
  fileType: string
  referer: string
}) {
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const ref = useRef<HTMLElement | null>(null)
  const { src, retry } = useProxyRetry(url, name, fileType, referer)

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
    const onError = () => {
      if (!retry()) setFailed(true)
    }
    el.addEventListener("error", onError)
    return () => el.removeEventListener("error", onError)
  }, [ready, src]) // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) return <Model3DFallback label="Couldn't load model" />
  if (!ready) return <Model3DFallback />

  return (
    <model-viewer
      ref={ref}
      key={src}
      src={src}
      alt={name}
      auto-rotate
      autoplay
      camera-controls
      disable-zoom
      touch-action="pan-y"
      shadow-intensity="1"
      className={`${PREVIEW_ASPECT} ${PREVIEW_SHAPE} w-full bg-muted`}
    />
  )
}

// Everything <model-viewer> has no parser for.
function ThreePreview({
  url,
  fileType,
  referer,
}: {
  url: string
  fileType: string
  referer: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<"loading" | "shown" | "failed">("loading")

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false
    let handle: { dispose(): void } | null = null

    const urls = [url]
    if (canRetryProxied(url, fileType)) {
      urls.push(downloadHref({ url, name: url.split("/").pop() ?? "model" }, referer))
    }

    import("@/lib/pullsrc/model3d-viewer")
      .then(({ mountModel3D }) =>
        mountModel3D(canvas, { urls, ext: modelExtension(url, fileType) })
      )
      .then((mounted) => {
        if (cancelled) mounted.dispose()
        else {
          handle = mounted
          setState("shown")
        }
      })
      .catch(() => {
        if (!cancelled) setState("failed")
      })

    return () => {
      cancelled = true
      handle?.dispose()
    }
  }, [url, fileType, referer])

  if (state === "failed") return <Model3DFallback label="Couldn't load model" />

  return (
    <div className={`relative ${PREVIEW_ASPECT} ${PREVIEW_SHAPE} w-full overflow-hidden bg-muted`}>
      <canvas ref={canvasRef} className="size-full" />
      {state === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <CategoryIcon category="model3d" className="size-7 animate-pulse text-muted-foreground" />
        </div>
      )}
    </div>
  )
}
