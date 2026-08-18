// One @font-face family is many files: a format per browser generation, a
// subset per unicode range, a file per weight. Turning that pile into a card
// with one headline download and a format menu is the same job whether the
// sources came from a stylesheet (site) or the CSSOM (extension), so it lives
// here rather than in either caller.

import {
  fontFormatFromUrl,
  isConvertible,
  type FontFormat,
} from "./font-convert";
import {
  fetchWithTimeout,
  formatBytes,
  mapWithConcurrency,
} from "./server/http";
import type { CreditInfo, FontAsset, MediaVariant } from "./types";

export interface FontSource {
  fontFamily: string;
  weight: string;
  url: string;
  format: FontFormat | null;
  /** False for subset files that can't render A-Z. */
  coversLatin: boolean;
}

// Installable formats first — if the page already ships one, nothing needs
// converting and the user gets the foundry's own bytes.
const FORMAT_RANK: FontFormat[] = ["otf", "ttf", "ttc", "woff2", "woff", "eot"];

function rankOf(format: FontFormat | null): number {
  const index = format ? FORMAT_RANK.indexOf(format) : -1;
  return index === -1 ? FORMAT_RANK.length : index;
}

/** Within one format, the file a person actually wants: full Latin, regular. */
function sourceScore(source: FontSource): number {
  let score = 0;
  if (source.coversLatin) score += 4;
  if (/^(?:400|normal)$/i.test(source.weight)) score += 1;
  return score;
}

const WEIGHT_ORDER = [
  "100",
  "200",
  "300",
  "400",
  "normal",
  "500",
  "600",
  "700",
  "bold",
  "800",
  "900",
];

function sortWeights(weights: string[]): string[] {
  return [...new Set(weights)].sort(
    (a, b) =>
      WEIGHT_ORDER.indexOf(a.toLowerCase()) -
      WEIGHT_ORDER.indexOf(b.toLowerCase()),
  );
}

function baseName(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : url;
  } catch {
    return url;
  }
}

function withExtension(name: string, extension: string): string {
  const match = /\.([a-z0-9]{1,5})$/i.exec(name);
  if (match && match[1].toLowerCase() === extension) return name;
  return `${match ? name.slice(0, match.index) : name}.${extension}`;
}

export interface FontProbe {
  sizeBytes: number | null;
  /** What the bytes actually are, whatever the URL and CSS claimed. */
  format: FontFormat | null;
  /** What the file unwraps to, read from the sfnt flavor in its header. */
  sfnt: "ttf" | "otf" | "ttc" | null;
}

/**
 * A HEAD gives the size but not what a WOFF2 is wrapping, and calling a CFF
 * font ".ttf" makes font installers reject it. Both WOFF and WOFF2 put the
 * sfnt flavor at byte 4, so eight bytes settle it.
 */
export async function probeFont(url: string): Promise<FontProbe> {
  const unknown: FontProbe = { sizeBytes: null, format: null, sfnt: null };
  try {
    const res = await fetchWithTimeout(url, {
      timeoutMs: 5000,
      headers: { range: "bytes=0-7" },
    });
    if (!res.ok || !res.body) return unknown;

    // A 206 reports the real length in Content-Range; an origin that ignored
    // Range sent the whole file, so Content-Length is already the real length.
    const total = /\/(\d+)$/.exec(res.headers.get("content-range") ?? "")?.[1];
    const sizeBytes =
      Number(total ?? res.headers.get("content-length")) || null;

    // An origin that ignored Range is streaming the whole font, so take the
    // first chunks that get us to eight bytes and drop the connection.
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let collected = 0;
    while (collected < 8) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      collected += value.length;
    }
    await reader.cancel().catch(() => {});

    if (collected < 8) return { ...unknown, sizeBytes };
    const head = new Uint8Array(8);
    let filled = 0;
    for (const chunk of chunks) {
      const slice = chunk.subarray(0, 8 - filled);
      head.set(slice, filled);
      filled += slice.length;
      if (filled === 8) break;
    }

    const tag = String.fromCharCode(...head.subarray(0, 4));
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const flavor = view.getUint32(4);

    // Only the wrappers carry a flavor at byte 4; a raw sfnt is its own tag.
    if (tag === "wOF2" || tag === "wOFF") {
      const format = tag === "wOF2" ? "woff2" : "woff";
      if (flavor === 0x4f54544f) return { sizeBytes, format, sfnt: "otf" };
      if (flavor === 0x74746366) return { sizeBytes, format, sfnt: "ttc" };
      return { sizeBytes, format, sfnt: "ttf" };
    }
    if (tag === "OTTO") return { sizeBytes, format: "otf", sfnt: "otf" };
    if (tag === "ttcf") return { sizeBytes, format: "ttc", sfnt: "ttc" };
    // 0x00010000 is the TrueType sfnt version; "true" is the old Mac spelling.
    if (tag === "true" || view.getUint32(0) === 0x00010000) {
      return { sizeBytes, format: "ttf", sfnt: "ttf" };
    }
    // Not a font at all — an expired link answering with a login page, say.
    return { ...unknown, sizeBytes };
  } catch {
    return unknown;
  }
}

interface FamilyPlan {
  fontFamily: string;
  weights: string[];
  /** Best file per format, installable formats first. */
  files: Array<{ url: string; format: FontFormat | null }>;
}

function planFamilies(sources: FontSource[], limit: number): FamilyPlan[] {
  const families = new Map<
    string,
    { weights: string[]; byFormat: Map<string, { url: string; score: number }> }
  >();

  for (const source of sources) {
    const format = source.format ?? fontFormatFromUrl(source.url);
    let family = families.get(source.fontFamily);
    if (!family) {
      family = { weights: [], byFormat: new Map() };
      families.set(source.fontFamily, family);
    }
    family.weights.push(source.weight);

    // Formats we can't identify are keyed by URL so they still show up, rather
    // than collapsing every unknown into one slot.
    const key = format ?? `unknown:${source.url}`;
    const score = sourceScore(source);
    const existing = family.byFormat.get(key);
    if (!existing || score > existing.score) {
      family.byFormat.set(key, { url: source.url, score });
    }
  }

  const plans: FamilyPlan[] = [...families.entries()].map(
    ([fontFamily, family]) => {
      const files = [...family.byFormat.entries()]
        .map(([key, entry]) => ({
          url: entry.url,
          format: key.startsWith("unknown:") ? null : (key as FontFormat),
        }))
        .sort((a, b) => rankOf(a.format) - rankOf(b.format));

      return { fontFamily, weights: sortWeights(family.weights), files };
    },
  );

  return mergeAliases(plans).slice(0, limit);
}

/**
 * Sites alias one file under several @font-face names — a "Light" and a
 * "Medium" pointing at the same .woff, a theme's "SF-Primary-Font" and
 * "SF-Secondary-Font" both resolving to the same upload. Those are one
 * typeface as far as anyone downloading it is concerned, and shipping a card
 * each turns a page with four fonts into a page with seventeen.
 *
 * The test is the files, not the names: a family whose every file another
 * family already offers has nothing of its own to download.
 */
function mergeAliases(plans: FamilyPlan[]): FamilyPlan[] {
  // Widest first, so the family with the fullest set is the one that absorbs
  // the others rather than being folded into a single-file alias of itself.
  const ordered = [...plans].sort((a, b) => b.files.length - a.files.length);
  const kept: FamilyPlan[] = [];

  for (const plan of ordered) {
    const urls = new Set(plan.files.map((file) => file.url));
    const host = kept.find((other) =>
      [...urls].every((url) => other.files.some((file) => file.url === url)),
    );

    if (host) {
      // The alias may still have named a weight the host's own faces didn't.
      host.weights = sortWeights([...host.weights, ...plan.weights]);
      continue;
    }
    kept.push(plan);
  }

  // Back to the order they were declared in: that is the page's own idea of
  // which typeface matters most, and sorting by file count is not.
  const rank = new Map(plans.map((plan, index) => [plan.fontFamily, index]));
  return kept.sort(
    (a, b) => (rank.get(a.fontFamily) ?? 0) - (rank.get(b.fontFamily) ?? 0),
  );
}

/**
 * Builds one card per family: a headline download in an installable format
 * (converted from the web wrapper when that's all the page ships) plus every
 * other format found, for the menu beside it.
 */
export async function buildFontAssets(
  sources: FontSource[],
  credit: CreditInfo,
  limit = 12,
): Promise<FontAsset[]> {
  const plans = planFamilies(sources, limit);

  // Flat so one concurrency pool covers every file of every family.
  const probeTargets = plans.flatMap((plan, planIndex) =>
    plan.files.map((file) => ({ planIndex, file })),
  );
  const probes = await mapWithConcurrency(probeTargets, 6, (target) =>
    probeFont(target.file.url),
  );

  const probeByUrl = new Map<string, FontProbe>();
  probeTargets.forEach((target, index) => {
    probeByUrl.set(target.file.url, probes[index]);
  });

  return plans.map((plan, index) => {
    // The probe read each file's first bytes, so the format is now known
    // rather than guessed from a URL that may carry no extension at all.
    const resolved = plan.files
      .map((file) => ({
        url: file.url,
        format: probeByUrl.get(file.url)?.format ?? file.format,
        probe: probeByUrl.get(file.url),
      }))
      .sort((a, b) => rankOf(a.format) - rankOf(b.format));

    // Two urls can turn out to be the same format — a CDN that answers a .woff
    // and a .ttf request with the same WOFF2 bytes, say. Once the bytes have
    // spoken, offering them as separate menu rows is a choice between three
    // things spelled "WOFF2".
    const files = resolved.filter(
      (file, index) =>
        resolved.findIndex((other) => other.format === file.format) === index,
    );

    // Every format the page serves, in rank order, exactly as it serves it.
    const asServed: MediaVariant[] = files.map((file) => ({
      url: file.url,
      name: withExtension(baseName(file.url), file.format ?? "font"),
      fileType: (file.format ?? "font").toUpperCase(),
      size: formatBytes(file.probe?.sizeBytes ?? null),
      sizeBytes: file.probe?.sizeBytes ?? null,
      wasStreaming: false,
    }));

    // A page that already ships an installable file needs no conversion. One
    // that ships both WOFF and WOFF2 needs exactly one: they unwrap to the
    // same font, so offering it twice is a choice with no difference.
    const installable = files.find((file) => !isConvertible(file.format));
    const source = installable
      ? undefined
      : files.find((file) => isConvertible(file.format));

    const variants: MediaVariant[] = [...asServed];
    if (source) {
      variants.unshift({
        url: source.url,
        name: withExtension(baseName(source.url), source.probe?.sfnt ?? "ttf"),
        fileType: (source.probe?.sfnt ?? "ttf").toUpperCase(),
        // The probed size is the wrapper's, and an unwrapped font runs two to
        // three times bigger — a wrong number is worse than none. sizeBytes
        // stays: it describes the fetch the converter makes.
        size: "—",
        sizeBytes: source.probe?.sizeBytes ?? null,
        wasStreaming: false,
        convertFont: true,
      });
    }

    // planFamilies put installable formats first, so with or without a
    // conversion the head of the list is the closest thing to the original.
    const headline = variants[0];
    if (headline) headline.recommended = true;

    return {
      id: `font-${index}`,
      category: "fonts",
      name: headline?.name ?? baseName(files[0].url),
      // The preview renders this with @font-face, so it has to stay a file a
      // browser can load — the served bytes, never the converted ones.
      url: files[0].url,
      fontFamily: plan.fontFamily,
      weights: plan.weights,
      convertFrom: source?.format ?? undefined,
      fileType: headline?.fileType ?? "FONT",
      size: headline?.size ?? "—",
      sizeBytes: headline?.sizeBytes ?? null,
      // One format is no choice at all, so the menu only appears when the
      // family really did turn up in more than one.
      variants: variants.length > 1 ? variants : undefined,
      credit,
    };
  });
}
