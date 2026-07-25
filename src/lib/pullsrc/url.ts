export function normalizeUrl(value: string): string {
  const trimmed = value.trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}
