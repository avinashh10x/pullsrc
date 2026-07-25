import type { DetailedHTMLProps, HTMLAttributes } from "react"

// React 19 resolves JSX via React.JSX, not the old bare global JSX namespace.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        alt?: string
        poster?: string
        loading?: "auto" | "lazy" | "eager"
        reveal?: "auto" | "interaction" | "manual"
        "auto-rotate"?: boolean
        "auto-rotate-delay"?: number
        "camera-controls"?: boolean
        "disable-zoom"?: boolean
        "disable-pan"?: boolean
        "shadow-intensity"?: string | number
        "shadow-softness"?: string | number
        exposure?: string | number
        "touch-action"?: string
        "interaction-prompt"?: "auto" | "when-focused" | "none"
        "camera-orbit"?: string
        "field-of-view"?: string
        ar?: boolean
      }
    }
  }
}
