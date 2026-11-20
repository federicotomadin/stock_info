import { TWELVE_DATA_API_KEY } from '../config.js'
import { fetchWithTimeout } from '../lib/http.js'
import { isValidOhlcvCandle } from '../lib/stock.js'

const TWELVE_DATA_URL = 'https://api.twelvedata.com/time_series'

export interface OhlcvCandle {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** Parses Twelve Data's /time_series payload (newest first) into ascending daily candles. */
export function parseTwelveDataCandles(payload: any, symbol: string, minRows = 30): OhlcvCandle[] {
  if (!payload || payload.status === 'error' || !Array.isArray(payload.values)) {
    const message = payload?.message ? `Twelve Data: ${payload.message}` : `Twelve Data returned no values for ${symbol}`
    throw new Error(message)
  }

  const candles: OhlcvCandle[] = payload.values
    .map((row: any) => ({
      date: String(row.datetime).slice(0, 10),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume) || 0,
    }))
    .filter((candle: OhlcvCandle) => isValidOhlcvCandle(candle))
    .sort((a: OhlcvCandle, b: OhlcvCandle) => a.date.localeCompare(b.date))

  if (candles.length < minRows) {
    throw new Error(`Twelve Data returned only ${candles.length} OHLCV rows for ${symbol} (need ${minRows}+).`)
  }
  return candles
}

/**
 * Daily OHLCV from Twelve Data. Free "Basic" plan: 800 credits/day, 8 credits/min,
 * 1 credit per time_series call. Used as the fallback between FMP and Yahoo.
 */
export async function fetchOhlcvFromTwelveData(symbol: string, { lookbackDays = 260 } = {}) {
  if (!TWELVE_DATA_API_KEY) {
    throw new Error('TWELVE_DATA_API_KEY not configured')
  }

  const url = new URL(TWELVE_DATA_URL)
  url.searchParams.set('symbol', symbol.toUpperCase())
  url.searchParams.set('interval', '1day')
  url.searchParams.set('outputsize', String(Math.min(5000, Math.max(30, lookbackDays))))
  url.searchParams.set('apikey', TWELVE_DATA_API_KEY)

  const response = await fetchWithTimeout(url.toString(), { headers: { Accept: 'application/json' } }, 15000)
  const payload = await response.json().catch(() => null)
  if (!payload && !response.ok) {
    throw new Error(`Twelve Data HTTP ${response.status}`)
  }
  return parseTwelveDataCandles(payload, symbol)
}
