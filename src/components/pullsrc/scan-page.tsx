"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ShieldAlert, Unplug } from "lucide-react"

import { cn } from "@/lib/utils"
import { normalizeUrl } from "@/lib/pullsrc/url"
import { ScanningView } from "@/components/pullsrc/scanning-view"
import { ErrorView } from "@/components/pullsrc/error-view"
import { ResultsView } from "@/components/pullsrc/results-view"
import { CreditSheetView } from "@/components/pullsrc/credit-sheet-view"
import {
  CATEGORY_ORDER,
  type AssetCategory,
  type ScanErrorKind,
  type ScanResult,
  type ScanStreamEvent,
} from "@/lib/pullsrc/types"

type Phase =
  | { name: "scanning" }
  | { name: "error"; kind: ScanErrorKind; message: string }
  | {
    name: "results"
    result: ScanResult
    pendingCategories: Set<AssetCategory>
    scanning: boolean
  }
  | {
    name: "credit-sheet"
    result: ScanResult
    pendingCategories: Set<AssetCategory>
    scanning: boolean
  }

export function ScanPage() {
  const router = useRouter()
  const rawUrl = useSearchParams().get("url") ?? ""
  const url = rawUrl ? normalizeUrl(rawUrl) : ""

  const [phase, setPhase] = useState<Phase>({ name: "scanning" })
  const goHome = () => router.push("/")
  const runIdRef = useRef(0)

  useEffect(() => {
    if (!url) {
      router.replace("/")
      return
    }

    const runId = ++runIdRef.current
    const controller = new AbortController()
    setPhase({ name: "scanning" })

    const applyEvent = (event: ScanStreamEvent) => {
      if (runIdRef.current !== runId) return
      setPhase((current) => {
        switch (event.type) {
          case "meta":
            return {
              name: "results",
              result: {
                pageUrl: event.pageUrl,
                pageTitle: event.pageTitle,
                sourceDomain: event.sourceDomain,
                scanDate: event.scanDate,
                assets: [],
              },
              pendingCategories: new Set(CATEGORY_ORDER),
              scanning: true,
            }

          case "category":
            if (current.name !== "results") return current
            return {
              ...current,
              result: { ...current.result, assets: [...current.result.assets, ...event.assets] },
            }

          case "asset":
            if (current.name !== "results") return current
            return {
              ...current,
              result: { ...current.result, assets: [...current.result.assets, event.asset] },
            }

          case "category-done": {
            if (current.name !== "results") return current
            const nextPending = new Set(current.pendingCategories)
            nextPending.delete(event.category)
            return { ...current, pendingCategories: nextPending }
          }

          case "error":
            return { name: "error", kind: event.error.kind, message: event.error.message }

          case "notice":
            console.warn(`[pullsrc] ${event.scope}: ${event.message}`)
            return current

          case "done":
            if (current.name !== "results") return current
            return { ...current, scanning: false }
        }
      })
    }

    async function run() {
      try {
        const res = await fetch("/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
          signal: controller.signal,
        })

        if (!res.body) throw new Error("Response had no body")

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          let newlineIndex = buffer.indexOf("\n")
          while (newlineIndex >= 0) {
            const line = buffer.slice(0, newlineIndex)
            buffer = buffer.slice(newlineIndex + 1)
            if (line.trim()) applyEvent(JSON.parse(line) as ScanStreamEvent)
            newlineIndex = buffer.indexOf("\n")
          }
        }
        if (buffer.trim()) applyEvent(JSON.parse(buffer) as ScanStreamEvent)
      } catch {
        if (controller.signal.aborted) return
        if (runIdRef.current === runId) {
          setPhase({ name: "error", kind: "broken", message: "We couldn't reach that page." })
        }
      }
    }

    void run()

    return () => {
      controller.abort()
    }
  }, [url, router])

  useEffect(() => {
    if (phase.name === "results" || phase.name === "credit-sheet") {
      document.title = `${phase.result.pageTitle} — PullSRC`
    }
  }, [phase])

  const isDashboardPhase = phase.name === "results" || phase.name === "credit-sheet"

  return (
    <div
      className={cn(
        "flex w-full flex-1 flex-col items-center py-16",
        isDashboardPhase ? "justify-start" : "justify-center"
      )}
    >
      {phase.name === "scanning" && <ScanningView url={url} />}

      {phase.name === "error" && phase.kind === "blocked" && (
        <ErrorView
          icon={ShieldAlert}
          title="This page blocked the scan"
          description={phase.message}
          url={url}
          actionLabel="Try another url"
          onAction={goHome}
          suggestExtension
        />
      )}

      {phase.name === "error" && phase.kind !== "blocked" && (
        <ErrorView
          icon={Unplug}
          title="Couldn't reach that page"
          description={phase.message}
          url={url}
          actionLabel="Try again"
          onAction={goHome}
        />
      )}

      {phase.name === "results" && (
        <ResultsView
          result={phase.result}
          scanning={phase.scanning}
          pendingCategories={phase.pendingCategories}
          onNewScan={goHome}
          onOpenCreditSheet={() =>
            setPhase({
              name: "credit-sheet",
              result: phase.result,
              pendingCategories: phase.pendingCategories,
              scanning: phase.scanning,
            })
          }
        />
      )}

      {phase.name === "credit-sheet" && (
        <CreditSheetView
          result={phase.result}
          onBack={() =>
            setPhase({
              name: "results",
              result: phase.result,
              pendingCategories: phase.pendingCategories,
              scanning: phase.scanning,
            })
          }
        />
      )}
    </div>
  )
}
