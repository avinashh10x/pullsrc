import { LandingHero } from "@/components/pullsrc/landing-hero"
import { LandingContent } from "@/components/pullsrc/landing-content"
import { buildJsonLd } from "@/lib/pullsrc/seo"

export default function Home() {
  return (
    <main className="flex w-full flex-1 flex-col items-center">
      <script
        type="application/ld+json"
        // Content is a literal built in seo.ts, never user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildJsonLd()) }}
      />
      <LandingHero />
      <LandingContent />
    </main>
  )
}
