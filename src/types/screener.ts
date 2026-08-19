import { analyzeTrend } from '../lib/trend'
import type { CountryLabel, EnrichedStock, TrendAnalysis } from './stock'

export interface ScreenerApiRow {
  symbol: string
  name: string
  exchange: string
  country: CountryLabel
  price: number
  updatedAt: string
  dayChange: number | null
  monthChange: number | null
  yearChange: number | null
  rsi14?: number | null
  sma20?: number | null
  sma50?: number | null
  sma200?: number | null
  trend: TrendAnalysis
}

export interface ScreenerSyncProgress {
  symbolsLoaded: number
  symbolsTotal: number
  updated: number
  unchanged: number
  failed: number
}

export interface ScreenerSyncStatus {
  enabled: boolean
  syncing: boolean
  totalTickers: number
  totalQuotes: number
  lastSyncAt: string | null
  lastSyncUpdated: number | null
  lastSyncUnchanged: number | null
  lastSyncFailed: number | null
  progress: ScreenerSyncProgress | null
  error?: string
}

/** Formats an ISO date (e.g. Render Postgres expiry) into a human-readable long date, or null if invalid. */
export function formatDbExpiryLabel(isoDate: string): string | null {
  const parsed = new Date(`${isoDate}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return parsed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/** Converts a raw DB screener row into an EnrichedStock, recomputing the trend on the client so
 * labels stay current even if the DB-stored trend is stale. */
export function mapScreenerRow(row: ScreenerApiRow): EnrichedStock {
  const quote = {
    symbol: row.symbol,
    price: row.price,
    updatedAt: row.updatedAt,
    dayChange: row.dayChange,
    monthChange: row.monthChange,
    yearChange: row.yearChange,
    rsi14: row.rsi14,
    sma20: row.sma20,
    sma50: row.sma50,
    sma200: row.sma200,
  }

  return {
    ...quote,
    name: row.name,
    exchange: row.exchange,
    country: row.country,
    // Recompute on client so profile picks follow latest Momentum rules even if DB labels are stale.
    trend: analyzeTrend(quote),
  }
}
