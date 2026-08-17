"use client"

import { useCallback, useEffect, useState } from "react"
import Image from "next/image"
import { CircleCheck, Puzzle, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  EXTENSION_POINTS,
  EXTENSION_STATUS,
  EXTENSION_URL,
} from "@/lib/pullsrc/seo"

// Bump to re-show the modal to everyone who already dismissed it. v2 = launch.
const STORAGE_KEY = "pullsrc:extension-popup:v2"
const DELAY_MS = 1200

export function ExtensionPopup() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // localStorage throws in some privacy modes; a missing modal is fine.
    try {
      if (window.localStorage.getItem(STORAGE_KEY)) return
    } catch {
      return
    }

    const timer = window.setTimeout(() => setVisible(true), DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [])

  const dismiss = useCallback(() => {
    setVisible(false)
    try {
      window.localStorage.setItem(STORAGE_KEY, "1")
    } catch {
      // Not remembering the dismissal is better than breaking the page.
    }
  }, [])

  // Escape closes it, and the page behind it stays put while it's open.
  useEffect(() => {
    if (!visible) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss()
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", onKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [visible, dismiss])

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={dismiss}
        className="absolute inset-0 cursor-default bg-[#062b25]/55 backdrop-blur-sm animate-in fade-in duration-300"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="extension-popup-title"
        className="relative flex max-h-[90svh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-[0_40px_100px_rgba(15,106,91,0.35)] animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-300"
      >
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="absolute right-3 top-3 z-10 rounded-full bg-white/80 p-1.5 text-muted-foreground shadow-sm backdrop-blur transition hover:bg-white hover:text-foreground"
        >
          <X className="size-4" />
        </button>

        <Image
          src="/extension-preview.png"
          alt="The PullSRC side panel open next to a webpage, listing the images, fonts, colors, 3D models, video, and audio it found."
          width={1672}
          height={941}
          priority
          sizes="(max-width: 640px) 100vw, 512px"
          className="w-full shrink-0 border-b border-border object-cover"
        />

        <div className="overflow-y-auto p-6">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            <CircleCheck className="size-3" aria-hidden />
            {EXTENSION_STATUS}
          </span>

          <h2
            id="extension-popup-title"
            className="mt-3 font-heading text-2xl uppercase tracking-normal text-foreground sm:text-3xl"
          >
            PullSRC is now on Chrome
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            A side panel that scans the tab you already have open — so it pulls
            assets from anything you can see, including pages behind a login.
            Free, and the best way to use PullSRC.
          </p>

          <ul className="mt-4 space-y-1.5">
            {EXTENSION_POINTS.map((point) => (
              <li
                key={point.title}
                className="flex items-center gap-2 text-sm text-foreground"
              >
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full bg-primary"
                />
                {point.title}
              </li>
            ))}
          </ul>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
            {EXTENSION_URL ? (
              <Button
                size="lg"
                className="h-11 flex-1"
                render={
                  <a href={EXTENSION_URL} target="_blank" rel="noreferrer" />
                }
                onClick={dismiss}
              >
                <Puzzle />
                Add to Chrome — free
              </Button>
            ) : (
              <Button
                size="lg"
                variant="outline"
                className="h-11 flex-1 cursor-not-allowed"
                disabled
              >
                <Puzzle />
                Listing unavailable
              </Button>
            )}
            <Button
              size="lg"
              variant="ghost"
              className="h-11 sm:w-auto"
              onClick={dismiss}
            >
              Keep scanning
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
