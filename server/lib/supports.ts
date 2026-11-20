import { computeTechnicalSnapshot } from './indicators.js'
import { sanitizeOhlcvCandles } from './stock.js'
import { fetchOhlcv } from '../technicalAnalysis.js'

export interface TechnicalContext {
  supports: Array<{ level: number }>
  sma20: number | null
}

/**
 * Daily bars barely move intraday, and the agent asks for the same symbols every cycle
 * (every 15 min). Caching for a few hours keeps FMP's free daily quota (250 req) for the rest.
 */
const CONTEXT_TTL_MS = 4 * 60 * 60 * 1000
const contextCache = new Map<string, { value: TechnicalContext; savedAt: number }>()

/** Supports only refine the stop; without OHLCV the caller falls back to the default % stop. */
export async function fetchTechnicalContext(symbol: string): Promise<TechnicalContext> {
  const key = symbol.toUpperCase()
  const hit = contextCache.get(key)
  if (hit && Date.now() - hit.savedAt < CONTEXT_TTL_MS) return hit.value

  const value = await computeTechnicalContext(symbol)
  // Only cache useful results: a failed fetch (e.g. FMP limit) should retry on the next cycle.
  if (value.supports.length || value.sma20 != null) {
    contextCache.set(key, { value, savedAt: Date.now() })
  }
  return value
}

async function computeTechnicalContext(symbol: string): Promise<TechnicalContext> {
  try {
    const { candles } = await fetchOhlcv(symbol, { lookbackDays: 260 })
    const { candles: cleanCandles } = sanitizeOhlcvCandles(candles)
    if (cleanCandles.length < 30) return { supports: [], sma20: null }
    const snapshot = computeTechnicalSnapshot(symbol, cleanCandles)
    return {
      supports: snapshot.supports ?? [],
      sma20: Number.isFinite(snapshot.indicators?.sma20) ? Number(snapshot.indicators.sma20) : null,
    }
  } catch {
    return { supports: [], sma20: null }
  }
}
