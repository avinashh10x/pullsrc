"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { HeroBackground } from "@/components/pullsrc/hero-background"
import { LandingInput } from "@/components/pullsrc/landing-input"
import { normalizeUrl } from "@/lib/pullsrc/url"

export default function Home() {
  const router = useRouter()
  const [url, setUrl] = useState("")

  const handleSubmit = () => {
    if (!url.trim()) return
    router.push(`/scan?url=${encodeURIComponent(normalizeUrl(url))}`)
  }

  return (
    <HeroBackground>
      <LandingInput value={url} onChange={setUrl} onSubmit={handleSubmit} />
    </HeroBackground>
  )
}
