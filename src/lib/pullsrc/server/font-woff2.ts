// The WOFF2 half of the font converter, kept out of the isomorphic module: it
// is ~300KB of Emscripten wasm whose glue only runs where dynamic code
// generation is allowed, which rules out the extension's side panel.

/**
 * Loaded on demand — it only matters once somebody actually downloads a WOFF2,
 * and until then it has no business sitting in the function's cold start.
 */
export async function decodeWoff2(bytes: Uint8Array): Promise<Uint8Array> {
  const wawoff2 = await import("wawoff2/decompress.js")
  const decompress = (wawoff2.default ?? wawoff2) as (
    input: Uint8Array
  ) => Promise<Uint8Array>
  return new Uint8Array(await decompress(bytes))
}
