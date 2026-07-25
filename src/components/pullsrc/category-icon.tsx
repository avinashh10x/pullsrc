import type { CSSProperties } from "react"
import {
  Image as ImageIcon,
  Type,
  Award,
  Palette,
  Video,
  Music,
  Box,
  type LucideIcon,
} from "lucide-react"

import type { AssetCategory } from "@/lib/pullsrc/types"

export const CATEGORY_ICON: Record<AssetCategory, LucideIcon> = {
  images: ImageIcon,
  fonts: Type,
  logo: Award,
  colors: Palette,
  video: Video,
  audio: Music,
  model3d: Box,
}

export function CategoryIcon({
  category,
  className,
  style,
}: {
  category: AssetCategory
  className?: string
  style?: CSSProperties
}) {
  const Icon = CATEGORY_ICON[category]
  return <Icon className={className} style={style} />
}
