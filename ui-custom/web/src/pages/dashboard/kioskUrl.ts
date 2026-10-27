export function buildKioskURL(rawURL: string): string {
  const url = new URL(rawURL)
  const additions: string[] = []
  if (!url.searchParams.has('kiosk')) additions.push('kiosk')
  if (!url.searchParams.has('hideLogo')) additions.push('hideLogo=true')
  if (additions.length === 0) return rawURL
  return `${rawURL}${url.search ? '&' : '?'}${additions.join('&')}`
}
