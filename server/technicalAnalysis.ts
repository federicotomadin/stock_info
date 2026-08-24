import { FMP_API_KEY } from './config.js'
import { fetchWithTimeout } from './lib/http.js'
import { buildSmaSeries } from './lib/indicators.js'
import { fetchOhlcvFromFmp } from './providers/fmp.js'
import { fetchOhlcvFromYahoo } from './providers/yahoo.js'

// In-memory per-symbol technical-analysis cache, persisted to disk and loaded at startup.
export const technicalAnalysisCache = new Map()

/**
 * Tries FMP first (better data, especially adjusted closes), then Yahoo as fallback.
 * Returns { candles, dataSource, fmpError? } so the endpoint can surface the source used.
 */
export async function fetchOhlcv(symbol, options = {}) {
  let fmpError = null

  if (FMP_API_KEY) {
    try {
      const candles = await fetchOhlcvFromFmp(symbol, options)
      return { candles, dataSource: 'fmp', fmpError: null }
    } catch (error) {
      fmpError = error?.message ?? String(error)
    }
  } else {
    fmpError = 'FMP_API_KEY not configured'
  }

  try {
    const candles = await fetchOhlcvFromYahoo(symbol, options)
    return { candles, dataSource: 'yahoo', fmpError }
  } catch (yahooError) {
    const message = `OHLCV unavailable for ${symbol}. FMP: ${fmpError}. Yahoo: ${yahooError?.message ?? yahooError}`
    throw new Error(message)
  }
}

/**
 * Generates a server-side candlestick PNG via QuickChart.io.
 * Returns the image as a base64 string. Throws on failure (caller decides to degrade).
 */
export async function generateCandleChartPng(symbol, candles, { supports = [], resistances = [] } = {}) {
  const recent = candles.slice(-90)
  if (recent.length < 10) {
    throw new Error('Not enough candles to render chart')
  }

  const candleData = recent.map((c) => ({
    x: c.date,
    o: c.open,
    h: c.high,
    l: c.low,
    c: c.close,
  }))

  const sma20Series = buildSmaSeries(recent, 20)
  const sma50Series = buildSmaSeries(recent, 50)

  const annotations = {}
  supports.forEach((level, index) => {
    annotations[`sup${index}`] = {
      type: 'line',
      yMin: level.level,
      yMax: level.level,
      borderColor: 'rgba(5, 77, 40, 0.55)',
      borderWidth: 1.5,
      borderDash: [6, 4],
      label: {
        enabled: true,
        content: `S ${level.level.toFixed(2)}`,
        position: 'start',
        backgroundColor: 'rgba(226, 246, 213, 0.9)',
        color: '#054d28',
        font: { size: 10, weight: 'bold' },
      },
    }
  })
  resistances.forEach((level, index) => {
    annotations[`res${index}`] = {
      type: 'line',
      yMin: level.level,
      yMax: level.level,
      borderColor: 'rgba(208, 50, 56, 0.55)',
      borderWidth: 1.5,
      borderDash: [6, 4],
      label: {
        enabled: true,
        content: `R ${level.level.toFixed(2)}`,
        position: 'end',
        backgroundColor: 'rgba(254, 242, 242, 0.9)',
        color: '#d03238',
        font: { size: 10, weight: 'bold' },
      },
    }
  })

  const config = {
    type: 'candlestick',
    data: {
      datasets: [
        { label: symbol, data: candleData },
        {
          label: 'SMA 20',
          type: 'line',
          data: sma20Series,
          borderColor: 'rgba(30, 120, 200, 0.9)',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.2,
        },
        {
          label: 'SMA 50',
          type: 'line',
          data: sma50Series,
          borderColor: 'rgba(200, 90, 30, 0.9)',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.2,
        },
      ],
    },
    options: {
      plugins: {
        title: {
          display: true,
          text: `${symbol} — Daily candles (last ${recent.length} bars)`,
          font: { size: 16, weight: 'bold' },
        },
        legend: { display: true, position: 'top' },
        annotation: { annotations },
      },
      scales: {
        x: { type: 'timeseries' },
      },
    },
  }

  const response = await fetchWithTimeout(
    'https://quickchart.io/chart',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'image/png',
      },
      body: JSON.stringify({
        backgroundColor: 'white',
        width: 1000,
        height: 560,
        format: 'png',
        version: '4',
        chart: config,
      }),
    },
    15000
  )

  if (!response.ok) {
    throw new Error(`QuickChart HTTP ${response.status}`)
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('image/')) {
    throw new Error(`QuickChart returned unexpected content-type: ${contentType}`)
  }

  const buffer = await response.arrayBuffer()
  if (!buffer.byteLength) {
    throw new Error('QuickChart returned empty body')
  }
  return Buffer.from(buffer).toString('base64')
}
