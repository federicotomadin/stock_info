import { CACHE_TTL_MS, MARKET_SNAPSHOT_STORAGE_KEY } from '../constants/app'
import type { MarketSnapshotCache, StockQuote } from '../types/stock'

/** Reads the cached full-market snapshot from localStorage, or null if missing/expired/corrupted. */
export function readMarketSnapshotCache(): MarketSnapshotCache | null {
  try {
    const raw = localStorage.getItem(MARKET_SNAPSHOT_STORAGE_KEY)
    if (!raw) {
      return null
    }

    const cached = JSON.parse(raw)
    if (cached?.savedAt && Date.now() - cached.savedAt < CACHE_TTL_MS && cached.data?.length) {
      return cached
    }
  } catch {
    // Ignore corrupted cache.
  }

  return null
}

/** Persists a full-market snapshot to localStorage with a timestamp, best-effort (quota-safe). */
export function writeMarketSnapshotCache(data: StockQuote[]) {
  try {
    localStorage.setItem(
      MARKET_SNAPSHOT_STORAGE_KEY,
      JSON.stringify({ data, savedAt: Date.now() })
    )
  } catch {
    // Quota exceeded or storage unavailable.
  }
}
