const PRIVATE_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /\.local$/i,
  /\.internal$/i,
];

export function isPrivateHostname(hostname: string): boolean {
  return PRIVATE_HOSTNAME_PATTERNS.some((pattern) => pattern.test(hostname));
}

export class UnsafeUrlError extends Error {}

export function assertSafePublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Not a valid url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only http/https urls are supported");
  }
  if (isPrivateHostname(url.hostname)) {
    throw new UnsafeUrlError("That host can't be scanned");
  }
  return url;
}

const USER_AGENT =
  "Mozilla/5.0 (compatible; PullSRCBot/1.0; +https://pullsrc.app) AppleWebKit/537.36";

export async function fetchWithTimeout(
  url: string,
  { timeoutMs = 8000, ...init }: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "user-agent": USER_AGENT,
        accept: "*/*",
        ...(init.headers ?? {}),
      },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchTextSafely(
  url: string,
  opts?: { timeoutMs?: number; maxBytes?: number },
): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url, { timeoutMs: opts?.timeoutMs });
    if (!res.ok) return null;
    const text = await res.text();
    const maxBytes = opts?.maxBytes ?? 2_000_000;
    return text.length > maxBytes ? text.slice(0, maxBytes) : text;
  } catch {
    return null;
  }
}

export async function headSafely(
  url: string,
  timeoutMs = 4000,
): Promise<{
  contentType: string | null;
  contentLength: number | null;
} | null> {
  try {
    const res = await fetchWithTimeout(url, { method: "HEAD", timeoutMs });
    if (!res.ok) return null;
    const len = res.headers.get("content-length");
    return {
      contentType: res.headers.get("content-type"),
      contentLength: len ? Number(len) : null,
    };
  } catch {
    return null;
  }
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || Number.isNaN(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function resolveUrl(maybeRelative: string, base: string): string | null {
  try {
    const resolved = new URL(maybeRelative, base);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:")
      return null;
    return resolved.toString();
  } catch {
    return null;
  }
}
