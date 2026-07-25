export function normalizeUrl(value: string): string {
  const trimmed = value.trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

export function looksLikeBareDomain(value: string): boolean {
  const withoutProtocol = value
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
  return (
    withoutProtocol.length > 0 &&
    !withoutProtocol.includes("/") &&
    withoutProtocol.includes(".")
  )
}
