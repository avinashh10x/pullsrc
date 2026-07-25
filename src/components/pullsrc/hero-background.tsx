"use client"

import { type ReactNode } from "react"

export function HeroBackground({ children }: { children: ReactNode }) {
  return (
    <main className="flex w-full flex-1 flex-col items-center justify-center bg-[radial-gradient(circle_at_50%_18%,rgba(15,106,91,0.16),transparent_34%),linear-gradient(180deg,#f7fffb_0%,#eef8f3_52%,#ffffff_100%)] px-4 py-16">
      {children}
    </main>
  )
}
