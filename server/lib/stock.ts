import { findCloseAtOrBefore, formatIsoDateFromUnix, toPercent } from './utils.js'
import { rsi, sma } from './indicators.js'

const TRADING_DAYS_PER_MONTH = 21
const TRADING_DAYS_PER_YEAR = 252

export function isValidOhlcvCandle(candle) {
  return (
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) &&
    candle.close > 0 &&
    candle.high > 0 &&
    candle.low > 0
  )
}

export function sanitizeOhlcvCandles(candles) {
  const valid = candles.filter(isValidOhlcvCandle)
  const dropped = candles.length - valid.length
  return { candles: valid, droppedInvalidBars: dropped }
}

export function normalizeOhlcvRows(rows) {
  return sanitizeOhlcvCandles(
    [...rows]
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map((row) => ({
        date: String(row.date).slice(0, 10),
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close ?? row.adjClose),
        volume: Number(row.volume ?? 0),
      }))
  ).candles
}

export function buildStockFromCsv(symbol, csv) {
  const lines = csv
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 3) {
    throw new Error(`Not enough historical data for ${symbol}.`)
  }

  const rows = lines.slice(1).map((line) => line.split(','))
  const latest = rows.at(-1)
  if (!latest) {
    throw new Error(`Not enough historical data for ${symbol}.`)
  }

  const closes = rows.map((row) => Number(row[4]))
  return buildStockFromSortedDailyCloses(symbol, closes, latest[0])
}

/**
 * Daily closes in chronological order (oldest → newest). Null/NaN entries are allowed between valid closes.
 * Also derives SMA20/50/200 and RSI14 from the same series — it's already downloaded for the
 * day/month/year % change math below, so this is free (no extra FMP/Yahoo/Stooq requests).
 */
export function buildStockFromSortedDailyCloses(symbol, closes, updatedAtRaw) {
  if (!Array.isArray(closes) || !closes.length) {
    throw new Error(`Not enough historical data for ${symbol}.`)
  }

  const latestIndex = closes.findLastIndex((value) => Number.isFinite(value))
  if (latestIndex < 0) {
    throw new Error(`Not enough historical data for ${symbol}.`)
  }

  const latestClose = findCloseAtOrBefore(closes, latestIndex)
  if (!Number.isFinite(latestClose)) {
    throw new Error(`Could not parse latest price for ${symbol}.`)
  }

  // Fresh IPOs lack a full window: leave that % change as null instead of measuring from the
  // listing price, otherwise a post-IPO pop reads as a confirmed 1Y uptrend (false Momentum).
  const previousClose =
    latestIndex >= 1 ? findCloseAtOrBefore(closes, latestIndex - 1) : null
  const monthClose =
    latestIndex >= TRADING_DAYS_PER_MONTH
      ? findCloseAtOrBefore(closes, latestIndex - TRADING_DAYS_PER_MONTH)
      : null
  const yearClose =
    latestIndex >= TRADING_DAYS_PER_YEAR
      ? findCloseAtOrBefore(closes, latestIndex - TRADING_DAYS_PER_YEAR)
      : null

  let updatedAt = ''
  if (updatedAtRaw != null) {
    updatedAt = String(updatedAtRaw).slice(0, 10)
  }

  const closesUpToLatest = closes.slice(0, latestIndex + 1).filter((v) => Number.isFinite(v))

  return {
    symbol,
    price: latestClose,
    updatedAt,
    dayChange: Number.isFinite(previousClose) ? toPercent(latestClose, previousClose) : null,
    monthChange: Number.isFinite(monthClose) ? toPercent(latestClose, monthClose) : null,
    yearChange: Number.isFinite(yearClose) ? toPercent(latestClose, yearClose) : null,
    rsi14: rsi(closesUpToLatest, 14),
    sma20: sma(closesUpToLatest, 20),
    sma50: sma(closesUpToLatest, 50),
    sma200: sma(closesUpToLatest, 200),
  }
}

export function buildStockFromYahoo(symbol, payload) {
  const result = payload?.chart?.result?.[0]
  const closes = result?.indicators?.quote?.[0]?.close
  const timestamps = result?.timestamp

  if (!Array.isArray(closes) || !Array.isArray(timestamps) || !closes.length) {
    throw new Error(`Could not parse Yahoo payload for ${symbol}.`)
  }

  const latestIndex = closes.findLastIndex((value) => Number.isFinite(value))
  if (latestIndex < 0) {
    throw new Error(`Not enough historical data for ${symbol}.`)
  }

  return buildStockFromSortedDailyCloses(
    symbol,
    closes,
    formatIsoDateFromUnix(timestamps[latestIndex])
  )
}
