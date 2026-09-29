import { fetchWithTimeout } from '../lib/http.js'

const SCREENER_URL = 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&download=true'
// nasdaq.com rejects requests without browser-like headers.
const SCREENER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
  Accept: 'application/json',
}
const MARKET_CAP_TTL_MS = 24 * 60 * 60 * 1000
const RETRY_AFTER_FAILURE_MS = 30 * 60 * 1000

let cache: { caps: Map<string, number>; savedAt: number; ttlMs: number } | null = null
let inFlight: Promise<Map<string, number>> | null = null

// The screener writes share classes as "BRK/B"; the rest of the app uses "BRK.B".
const normalizeSymbol = (symbol: string): string => symbol.trim().toUpperCase().replace('/', '.')

async function downloadMarketCaps(): Promise<Map<string, number>> {
  const response = await fetchWithTimeout(SCREENER_URL, { headers: SCREENER_HEADERS }, 20_000)
  if (!response.ok) {
    throw new Error(`Nasdaq screener HTTP ${response.status}`)
  }
  const payload = (await response.json()) as {
    data?: { rows?: Array<{ symbol?: string; marketCap?: string }> }
  }
  const rows = payload?.data?.rows ?? []

  const caps = new Map<string, number>()
  for (const row of rows) {
    const marketCap = Number(row.marketCap)
    if (row.symbol && Number.isFinite(marketCap) && marketCap > 0) {
      caps.set(normalizeSymbol(row.symbol), marketCap)
    }
  }
  if (!caps.size) {
    throw new Error('Nasdaq screener returned no market caps')
  }
  return caps
}

/**
 * Market cap (USD) by symbol for every US-listed stock, from one nasdaq.com request per day.
 * Never throws: on failure it returns the last good map (or an empty one) and retries later.
 */
export async function fetchMarketCaps(): Promise<Map<string, number>> {
  if (cache && Date.now() - cache.savedAt < cache.ttlMs) {
    return cache.caps
  }
  if (inFlight) {
    return inFlight
  }

  inFlight = downloadMarketCaps()
    .then((caps) => {
      cache = { caps, savedAt: Date.now(), ttlMs: MARKET_CAP_TTL_MS }
      return caps
    })
    .catch((error) => {
      console.warn('Market caps unavailable:', error?.message ?? error)
      const caps = cache?.caps ?? new Map<string, number>()
      cache = { caps, savedAt: Date.now(), ttlMs: RETRY_AFTER_FAILURE_MS }
      return caps
    })
    .finally(() => {
      inFlight = null
    })

  return inFlight
}
