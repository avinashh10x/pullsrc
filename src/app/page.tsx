"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { HeroBackground } from "@/components/pullsrc/hero-background"
import { LandingInput } from "@/components/pullsrc/landing-input"
import { looksLikeBareDomain, normalizeUrl } from "@/lib/pullsrc/url"

export default function Home() {
  const router = useRouter()
  const [url, setUrl] = useState("")
  const [showBareDomainWarning, setShowBareDomainWarning] = useState(false)

  const handleSubmit = () => {
    if (!url.trim()) return

    if (looksLikeBareDomain(url)) {
      setShowBareDomainWarning(true)
      return
    }

    setShowBareDomainWarning(false)
    router.push(`/scan?url=${encodeURIComponent(normalizeUrl(url))}`)
  }

  return (
    <HeroBackground>
      <LandingInput
        value={url}
        onChange={(value) => {
          setUrl(value)
          setShowBareDomainWarning(false)
        }}
        onSubmit={handleSubmit}
        showBareDomainWarning={showBareDomainWarning}
      />
    </HeroBackground>
  )
}
