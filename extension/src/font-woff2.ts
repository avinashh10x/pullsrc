import { SITE_URL } from "@/lib/pullsrc/seo";

// The one thing the panel can't do in the user's own browser. Unwrapping WOFF2
// means Brotli plus the glyf transforms reversed, and every decoder that
// exists is an Emscripten build whose embind glue compiles its invokers with
// `new Function`. MV3 forbids that outright and the Web Store won't accept a
// policy that allows it, so these bytes — and only these — take a round trip.
//
// WOFF, TTF and OTF never leave the machine: WOFF unwraps with nothing more
// than DecompressionStream, and the rest already install as they are.

// Overridable at build time (PULLSRC_API=http://localhost:3000 npm run build:ext)
// so the panel can be tested against a local server before the converter is
// live. Falls back to the published site.
declare const __PULLSRC_API__: string | undefined;
const API_BASE =
  typeof __PULLSRC_API__ === "string" && __PULLSRC_API__ ? __PULLSRC_API__ : SITE_URL;

/** Whatever went wrong, the raw WOFF2 is still one row down in the menu. */
const FALLBACK_HINT = "— you can still download it as WOFF2";

async function reason(res: Response): Promise<string> {
  // The route answers errors in plain text. Anything else is the platform
  // talking, not us: a 404 HTML page is not an error message worth showing.
  const body = await res.text().catch(() => "");
  const type = res.headers.get("content-type") ?? "";
  if (type.startsWith("text/plain") && body.length <= 200) return body;
  if (res.status === 404) {
    return `${API_BASE} has no font converter yet (it may need deploying)`;
  }
  return `the converter answered ${res.status}`;
}

export async function decodeWoff2(bytes: Uint8Array): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/font?name=font.woff2`, {
      method: "POST",
      headers: { "content-type": "font/woff2" },
      body: bytes as BodyInit,
    });
  } catch {
    throw new Error(
      `Can't reach ${API_BASE} to unwrap this WOFF2 ${FALLBACK_HINT}`,
    );
  }

  if (!res.ok) {
    throw new Error(`Couldn't unwrap this WOFF2: ${await reason(res)} ${FALLBACK_HINT}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}
