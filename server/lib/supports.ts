import { computeTechnicalSnapshot } from './indicators.js'
import { sanitizeOhlcvCandles } from './stock.js'
import { fetchOhlcv } from '../technicalAnalysis.js'

export interface TechnicalContext {
  supports: Array<{ level: number }>
  sma20: number | null
}

/** Supports only refine the stop; without OHLCV the caller falls back to the default % stop. */
export async function fetchTechnicalContext(symbol: string): Promise<TechnicalContext> {
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
