"use client"

import type { LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

export function ErrorView({
  icon: Icon,
  title,
  description,
  url,
  actionLabel,
  onAction,
}: {
  icon: LucideIcon
  title: string
  description: string
  url: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-4 text-center">
      <Card className="w-full items-center p-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <Icon className="size-5" />
        </div>
        <div className="mt-4 space-y-1.5">
          <h2 className="text-lg font-medium">{title}</h2>
          <p className="text-sm text-balance text-muted-foreground">
            {description}
          </p>
        </div>
        <div className="mt-3 max-w-full truncate rounded-md bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground">
          {url}
        </div>
        <Button onClick={onAction} className="mt-6">
          {actionLabel}
        </Button>
      </Card>
    </div>
  )
}
