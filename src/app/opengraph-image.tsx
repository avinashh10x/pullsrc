import { ImageResponse } from "next/og"

export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
          color: "#fafafa",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 88,
              height: 88,
              borderRadius: 22,
              background: "linear-gradient(135deg, #6366f1, #22d3ee)",
              fontSize: 44,
              fontWeight: 700,
            }}
          >
            P
          </div>
          <div style={{ fontSize: 96, fontWeight: 600, letterSpacing: -2 }}>
            PullSRC
          </div>
        </div>
        <div style={{ fontSize: 38, color: "#a1a1aa", marginTop: 28 }}>
          Every asset, one paste.
        </div>
      </div>
    ),
    { ...size }
  )
}
