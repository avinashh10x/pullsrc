// WOFF and WOFF2 are transport wrappers, not font formats: a designer who
// double-clicks one gets nothing installable on most systems. Both unwrap back
// to the sfnt (TTF/OTF) the foundry actually shipped, so the app converts
// rather than handing over a file the user can't use.
//
// Platform-free on purpose — the site converts on the server, the extension
// converts in the panel, and neither should get a different result.

export type FontFormat = "woff2" | "woff" | "ttf" | "otf" | "eot" | "ttc";

const FORMAT_BY_EXTENSION: Record<string, FontFormat> = {
  woff2: "woff2",
  woff: "woff",
  ttf: "ttf",
  otf: "otf",
  eot: "eot",
  ttc: "ttc",
};

// @font-face declares its own format(), which is the only hint when the URL is
// a query-string blob or an extensionless CDN path.
const FORMAT_BY_CSS_HINT: Record<string, FontFormat> = {
  woff2: "woff2",
  woff: "woff",
  truetype: "ttf",
  opentype: "otf",
  "embedded-opentype": "eot",
  collection: "ttc",
};

export function fontFormatFromUrl(url: string): FontFormat | null {
  const path = url.split(/[?#]/)[0];
  const extension = /\.([a-z0-9]{2,5})$/i.exec(path)?.[1]?.toLowerCase();
  return (extension && FORMAT_BY_EXTENSION[extension]) || null;
}

export function fontFormatFromCssHint(hint: string): FontFormat | null {
  return FORMAT_BY_CSS_HINT[hint.trim().toLowerCase()] ?? null;
}

export function isConvertible(format: FontFormat | null): boolean {
  return format === "woff2" || format === "woff";
}

/**
 * The sfnt version tag says whether the outlines are TrueType or CFF, which is
 * the difference between a .ttf and a .otf. Only the bytes know — a WOFF2 of a
 * CFF font unwraps to OTF, and naming it .ttf makes installers reject it.
 */
function sfntExtension(bytes: Uint8Array): "ttf" | "otf" | "ttc" {
  const tag = String.fromCharCode(...bytes.subarray(0, 4));
  if (tag === "OTTO") return "otf";
  if (tag === "ttcf") return "ttc";
  return "ttf";
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  // WOFF1 tables are zlib-wrapped, which is "deflate" in the compression
  // streams spec ("deflate-raw" is the headerless one).
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface WoffTable {
  tag: string;
  data: Uint8Array;
  checksum: number;
}

/**
 * WOFF1 is an sfnt whose tables were individually zlib-compressed and whose
 * directory was rewritten, so rebuilding one is header surgery plus inflate —
 * no glyph decoding involved.
 */
async function woffToSfnt(bytes: Uint8Array): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x774f4646) throw new Error("Not a WOFF file");

  const flavor = view.getUint32(4);
  const numTables = view.getUint16(12);

  const tables: WoffTable[] = [];
  for (let index = 0; index < numTables; index++) {
    const entry = 44 + index * 20;
    const tag = String.fromCharCode(...bytes.subarray(entry, entry + 4));
    const offset = view.getUint32(entry + 4);
    const compLength = view.getUint32(entry + 8);
    const origLength = view.getUint32(entry + 12);
    const checksum = view.getUint32(entry + 16);

    const stored = bytes.subarray(offset, offset + compLength);
    // Equal lengths mean the table was left uncompressed.
    const data =
      compLength >= origLength ? stored.slice() : await inflate(stored);
    tables.push({ tag, data, checksum });
  }

  return buildSfnt(flavor, tables);
}

function buildSfnt(flavor: number, tables: WoffTable[]): Uint8Array {
  // Table records must be sorted by tag; WOFF stores them that way already but
  // a rewritten file can't rely on it.
  const sorted = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const padded = (length: number) => (length + 3) & ~3;

  const headerSize = 12 + sorted.length * 16;
  const total = sorted.reduce(
    (sum, table) => sum + padded(table.data.length),
    headerSize,
  );

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  // searchRange/entrySelector/rangeShift are the binary-search hints in every
  // sfnt header; some rasterisers still read them, so compute them properly.
  const entrySelector = Math.floor(Math.log2(sorted.length));
  const searchRange = 2 ** entrySelector * 16;

  view.setUint32(0, flavor);
  view.setUint16(4, sorted.length);
  view.setUint16(6, searchRange);
  view.setUint16(8, entrySelector);
  view.setUint16(10, sorted.length * 16 - searchRange);

  let offset = headerSize;
  sorted.forEach((table, index) => {
    const record = 12 + index * 16;
    for (let byte = 0; byte < 4; byte++) {
      out[record + byte] = table.tag.charCodeAt(byte);
    }
    view.setUint32(record + 4, table.checksum);
    view.setUint32(record + 8, offset);
    view.setUint32(record + 12, table.data.length);

    out.set(table.data, offset);
    offset += padded(table.data.length);
  });

  return out;
}

/**
 * WOFF2 needs Brotli plus the glyf/loca transforms reversed — a real decoder,
 * not header surgery, and every one that exists is an Emscripten build whose
 * embind glue compiles invokers with `new Function`. That is fine on a server
 * and forbidden by the extension's content security policy, so who does the
 * decoding is the caller's decision rather than this module's.
 */
export type Woff2Decoder = (bytes: Uint8Array) => Promise<Uint8Array>;

export interface ConvertedFont {
  bytes: Uint8Array;
  extension: "ttf" | "otf" | "ttc";
}

/**
 * Unwraps a web font into the installable file it was built from. Formats that
 * are already installable are returned untouched.
 */
export async function toInstallableFont(
  bytes: Uint8Array,
  format: FontFormat | null,
  decodeWoff2?: Woff2Decoder,
): Promise<ConvertedFont> {
  const resolved = format ?? sniffFormat(bytes);
  if (!resolved) {
    throw new Error("That file doesn't start like any font format");
  }

  if (resolved === "woff2") {
    if (!decodeWoff2) throw new Error("No WOFF2 decoder was provided");
    const sfnt = await decodeWoff2(bytes);
    return { bytes: sfnt, extension: sfntExtension(sfnt) };
  }
  if (resolved === "woff") {
    const sfnt = await woffToSfnt(bytes);
    return { bytes: sfnt, extension: sfntExtension(sfnt) };
  }
  if (resolved === "eot") {
    throw new Error("EOT is an Internet Explorer format and can't be converted");
  }
  return { bytes, extension: sfntExtension(bytes) };
}

/** Signed CDN URLs often carry no extension, so fall back to the magic bytes. */
export function sniffFormat(bytes: Uint8Array): FontFormat | null {
  const tag = String.fromCharCode(...bytes.subarray(0, 4));
  if (tag === "wOF2") return "woff2";
  if (tag === "wOFF") return "woff";
  if (tag === "OTTO") return "otf";
  if (tag === "ttcf") return "ttc";
  const version = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(0);
  if (version === 0x00010000 || tag === "true") return "ttf";
  return null;
}
