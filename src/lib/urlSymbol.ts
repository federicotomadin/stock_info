/** Pretty SEO path `/stock/AAPL` (relative to Vite's base path, e.g. GitHub Pages project subpath). */
export function readSymbolFromPrettyPath(): string | null {
  if (typeof window === 'undefined') {
    return null
  }
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  let pathname = window.location.pathname
  if (base && pathname.startsWith(base)) {
    pathname = pathname.slice(base.length)
  }
  const match = pathname.match(/^\/?stock\/([A-Za-z0-9.-]+)\/?$/)
  const raw = match?.[1]?.trim().toUpperCase()
  return raw || null
}

/** Resolves the symbol for the fundamentals view: pretty `/stock/AAPL` path first, then the
 * legacy `?fundamentals=1&symbol=AAPL` query params. */
export function readFundamentalsSymbolFromUrl(): string | null {
  if (typeof window === 'undefined') {
    return null
  }
  const fromPath = readSymbolFromPrettyPath()
  if (fromPath) {
    return fromPath
  }
  const params = new URLSearchParams(window.location.search)
  if (params.get('fundamentals') !== '1') {
    return null
  }
  const raw = params.get('symbol')?.trim().toUpperCase()
  return raw || null
}

/** Resolves the symbol for the technical-analysis view from `?technical=1&symbol=AAPL`. */
export function readTechnicalSymbolFromUrl(): string | null {
  if (typeof window === 'undefined') {
    return null
  }
  const params = new URLSearchParams(window.location.search)
  if (params.get('technical') !== '1') {
    return null
  }
  const raw = params.get('symbol')?.trim().toUpperCase()
  return raw || null
}
