import { Suspense } from "react"
import type { Metadata } from "next"

import { ScanPage } from "@/components/pullsrc/scan-page"
import { ScanningView } from "@/components/pullsrc/scanning-view"

export const metadata: Metadata = {
  title: "Scan website assets",
  description:
    "Inspect a webpage, review extracted assets, and download collections directly from PullSRC.",
  alternates: {
    canonical: "/scan",
  },
  // Every ?url= variant is a thin page about someone else's site.
  robots: {
    index: false,
    follow: true,
  },
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex w-full flex-1 flex-col items-center justify-center py-16">
          <ScanningView url="" />
        </div>
      }
    >
      <ScanPage />
    </Suspense>
  )
}
