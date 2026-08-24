import { toPercent } from './utils.js'

export function sma(values, period) {
  if (!Array.isArray(values) || values.length < period) {
    return null
  }
  let sum = 0
  for (let i = values.length - period; i < values.length; i += 1) {
    sum += values[i]
  }
  return sum / period
}

/** Wilder's RSI. Returns null if not enough data. */
export function rsi(values, period = 14) {
  if (!Array.isArray(values) || values.length < period + 1) {
    return null
  }

  let gains = 0
  let losses = 0
  for (let i = 1; i <= period; i += 1) {
    const diff = values[i] - values[i - 1]
    if (diff >= 0) {
      gains += diff
    } else {
      losses -= diff
    }
  }
  let avgGain = gains / period
  let avgLoss = losses / period

  for (let i = period + 1; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
  }

  if (avgLoss === 0) {
    return 100
  }
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

/**
 * Finds local swing highs/lows using a window of `window` bars on each side.
 * Clusters the top levels into ~3 supports and ~3 resistances relative to `currentPrice`.
 */
export function detectSupportResistance(candles, currentPrice, { window = 5, lookback = 120 } = {}) {
  if (!Array.isArray(candles) || candles.length < window * 2 + 1) {
    return { supports: [], resistances: [] }
  }

  const slice = candles.slice(-lookback)
  const highs = []
  const lows = []

  for (let i = window; i < slice.length - window; i += 1) {
    const bar = slice[i]
    let isHigh = true
    let isLow = true
    for (let k = i - window; k <= i + window; k += 1) {
      if (k === i) continue
      if (slice[k].high >= bar.high) isHigh = false
      if (slice[k].low <= bar.low) isLow = false
    }
    if (isHigh) highs.push(bar.high)
    if (isLow) lows.push(bar.low)
  }

  function cluster(levels, priceRef) {
    if (!levels.length || !Number.isFinite(priceRef)) {
      return []
    }
    const tolerance = priceRef * 0.015
    const sorted = [...levels].sort((a, b) => a - b)
    const clusters = []
    for (const value of sorted) {
      const last = clusters[clusters.length - 1]
      if (last && Math.abs(last.avg - value) <= tolerance) {
        last.values.push(value)
        last.avg = last.values.reduce((sum, v) => sum + v, 0) / last.values.length
      } else {
        clusters.push({ avg: value, values: [value] })
      }
    }
    return clusters
      .map((c) => ({ level: c.avg, touches: c.values.length }))
      .sort((a, b) => b.touches - a.touches)
      .slice(0, 3)
      .sort((a, b) => a.level - b.level)
  }

  const allSupports = cluster(
    lows.filter((v) => v <= currentPrice),
    currentPrice
  )
  const allResistances = cluster(
    highs.filter((v) => v >= currentPrice),
    currentPrice
  )

  return { supports: allSupports, resistances: allResistances }
}

export function averageVolume(candles, period) {
  if (candles.length < period) return null
  const recent = candles.slice(-period)
  const sum = recent.reduce((acc, c) => acc + (Number.isFinite(c.volume) ? c.volume : 0), 0)
  return sum / period
}

export function computeTechnicalSnapshot(symbol, candles) {
  const closes = candles.map((c) => c.close)
  const latest = candles[candles.length - 1]
  const previous = candles[candles.length - 2]
  const monthBase = candles[Math.max(candles.length - 22, 0)]

  const currentPrice = latest.close
  const sma20 = sma(closes, 20)
  const sma50 = sma(closes, 50)
  const sma200 = sma(closes, 200)
  const rsi14 = rsi(closes, 14)
  const dayChange = toPercent(currentPrice, previous?.close)
  const monthChange = toPercent(currentPrice, monthBase?.close)
  const { supports, resistances } = detectSupportResistance(candles, currentPrice)
  const vol20 = averageVolume(candles, 20)
  const vol60 = averageVolume(candles, 60)
  const volumeTrend =
    Number.isFinite(vol20) && Number.isFinite(vol60) && vol60 > 0
      ? toPercent(vol20, vol60)
      : null

  const last30 = candles.slice(-30).map((c) => ({
    date: c.date,
    open: Number(c.open.toFixed(4)),
    high: Number(c.high.toFixed(4)),
    low: Number(c.low.toFixed(4)),
    close: Number(c.close.toFixed(4)),
    volume: c.volume,
  }))

  return {
    symbol,
    asOf: latest.date,
    currentPrice,
    indicators: {
      sma20,
      sma50,
      sma200,
      rsi14,
      dayChange,
      monthChange,
      avgVolume20: vol20,
      avgVolume60: vol60,
      volumeTrendPct: volumeTrend,
    },
    supports,
    resistances,
    recentCandles: last30,
  }
}

export function buildSmaSeries(candles, period) {
  if (candles.length < period) return []
  const out = []
  let sum = 0
  for (let i = 0; i < candles.length; i += 1) {
    sum += candles[i].close
    if (i >= period) {
      sum -= candles[i - period].close
    }
    if (i >= period - 1) {
      out.push({ x: candles[i].date, y: sum / period })
    }
  }
  return out
}
