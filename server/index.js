import cors from 'cors'
import express from 'express'
import http from 'node:http'

const app = express()
const PORT = Number(process.env.PORT || 9001)
const MAX_SYMBOLS = 120
const SYMBOL_CONCURRENCY = 4
const FETCH_RETRIES = 2
const CACHE_TTL_MS = 5 * 60 * 1000
const symbolCache = new Map()
const UNIVERSE_TTL_MS = 24 * 60 * 60 * 1000
let marketUniverseCache = { data: null, savedAt: 0 }
let stooqDisabledUntil = 0

app.use(cors())

function toPercent(current, base) {
  if (!Number.isFinite(current) || !Number.isFinite(base) || base === 0) {
    return null
  }

  return ((current - base) / base) * 100
}

function parseSymbols(rawInput = '') {
  const parsed = rawInput
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)

  return Array.from(new Set(parsed)).slice(0, MAX_SYMBOLS)
}

function toStooqTicker(symbol) {
  return symbol.includes('.') ? symbol.toLowerCase() : `${symbol.toLowerCase()}.us`
}

function toYahooTicker(symbol) {
  return symbol.replaceAll('.', '-')
}

function formatIsoDateFromUnix(seconds) {
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

function findCloseAtOrBefore(closes, index) {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const value = closes[cursor]
    if (Number.isFinite(value)) {
      return value
    }
  }
  return null
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withRetries(operation, retries = FETCH_RETRIES, delayMs = 250) {
  let lastError

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt === retries) {
        throw lastError
      }
      await wait(delayMs * (attempt + 1))
    }
  }

  throw lastError
}

function buildStockFromCsv(symbol, csv) {
  const lines = csv
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 3) {
    throw new Error(`Not enough historical data for ${symbol}.`)
  }

  const rows = lines.slice(1).map((line) => line.split(','))
  const latest = rows.at(-1)
  const previous = rows.at(-2)
  const monthBase = rows.at(Math.max(rows.length - 22, 0))
  const yearBase = rows.at(Math.max(rows.length - 253, 0))

  if (!latest || !previous || !monthBase || !yearBase) {
    throw new Error(`Not enough historical data for ${symbol}.`)
  }

  const latestClose = Number(latest[4])
  const previousClose = Number(previous[4])
  const monthClose = Number(monthBase[4])
  const yearClose = Number(yearBase[4])

  if (!Number.isFinite(latestClose)) {
    throw new Error(`Could not parse price for ${symbol}.`)
  }

  return {
    symbol,
    price: latestClose,
    updatedAt: latest[0],
    dayChange: toPercent(latestClose, previousClose),
    monthChange: toPercent(latestClose, monthClose),
    yearChange: toPercent(latestClose, yearClose),
  }
}

function buildStockFromYahoo(symbol, payload) {
  const result = payload?.chart?.result?.[0]
  const closes = result?.indicators?.quote?.[0]?.close
  const timestamps = result?.timestamp

  if (!Array.isArray(closes) || !Array.isArray(timestamps) || !closes.length) {
    throw new Error(`Could not parse Yahoo payload for ${symbol}.`)
  }

  const latestIndex = closes.findLastIndex((value) => Number.isFinite(value))
  if (latestIndex < 1) {
    throw new Error(`Not enough historical data for ${symbol}.`)
  }

  const latestClose = findCloseAtOrBefore(closes, latestIndex)
  const previousClose = findCloseAtOrBefore(closes, latestIndex - 1)
  const monthClose = findCloseAtOrBefore(closes, Math.max(latestIndex - 21, 0))
  const yearClose = findCloseAtOrBefore(closes, Math.max(latestIndex - 252, 0))

  if (
    !Number.isFinite(latestClose) ||
    !Number.isFinite(previousClose) ||
    !Number.isFinite(monthClose) ||
    !Number.isFinite(yearClose)
  ) {
    throw new Error(`Not enough historical data for ${symbol}.`)
  }

  return {
    symbol,
    price: latestClose,
    updatedAt: formatIsoDateFromUnix(timestamps[latestIndex]),
    dayChange: toPercent(latestClose, previousClose),
    monthChange: toPercent(latestClose, monthClose),
    yearChange: toPercent(latestClose, yearClose),
  }
}

async function fetchSymbolDataFromYahoo(symbol) {
  const yahooTicker = toYahooTicker(symbol)
  const hosts = [
    'https://query1.finance.yahoo.com',
    'https://query2.finance.yahoo.com',
  ]

  let lastError = null
  for (const host of hosts) {
    try {
      return await withRetries(async () => {
        const endpoint =
          `${host}/v8/finance/chart/${encodeURIComponent(yahooTicker)}` +
          '?range=2y&interval=1d&events=div,splits&includePrePost=false'
        const response = await fetchWithTimeout(
          endpoint,
          {
            headers: {
              'User-Agent': 'stock-info-local-app/1.0',
              Accept: 'application/json',
            },
          },
          12000
        )

        if (!response.ok) {
          throw new Error(`Yahoo HTTP ${response.status}`)
        }

        const payload = await response.json()
        const yahooError = payload?.chart?.error?.description
        if (yahooError) {
          throw new Error(yahooError)
        }

        return buildStockFromYahoo(symbol, payload)
      })
    } catch (error) {
      lastError = error
    }
  }

  throw new Error(
    `Yahoo fetch failed for ${symbol}: ${lastError?.message ?? 'unknown error'}`
  )
}

async function fetchSymbolData(symbol) {
  const cached = symbolCache.get(symbol)
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
    return cached.value
  }

  const stooqAvailable = Date.now() >= stooqDisabledUntil
  let value

  if (stooqAvailable) {
    try {
      value = await withRetries(async () => {
        const stooqTicker = toStooqTicker(symbol)
        const endpoint = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqTicker)}&i=d`
        const response = await fetchWithTimeout(endpoint, {}, 3000)

        if (!response.ok) {
          throw new Error(`Stooq HTTP ${response.status}`)
        }

        const csv = await response.text()
        if (csv.includes('Exceeded the daily hits limit')) {
          stooqDisabledUntil = Date.now() + 30 * 60 * 1000
          throw new Error('Stooq daily limit reached')
        }

        return buildStockFromCsv(symbol, csv)
      }, 1)
    } catch (error) {
      if (error?.name === 'AbortError') {
        stooqDisabledUntil = Date.now() + 30 * 60 * 1000
      }

      value = await fetchSymbolDataFromYahoo(symbol)
    }
  } else {
    value = await fetchSymbolDataFromYahoo(symbol)
  }

  symbolCache.set(symbol, { value, savedAt: Date.now() })
  return value
}

async function settleSymbolsWithConcurrency(symbols) {
  const results = Array(symbols.length)
  let cursor = 0

  async function runWorker() {
    while (cursor < symbols.length) {
      const currentIndex = cursor
      cursor += 1
      const symbol = symbols[currentIndex]

      try {
        const value = await fetchSymbolData(symbol)
        results[currentIndex] = { status: 'fulfilled', value }
      } catch (reason) {
        const message =
          reason?.message === 'fetch failed'
            ? `Network error while loading ${symbol}`
            : (reason?.message ?? `Could not load ${symbol}`)
        results[currentIndex] = {
          status: 'rejected',
          reason: new Error(message),
        }
      }
    }
  }

  const workerCount = Math.min(SYMBOL_CONCURRENCY, symbols.length)
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()))
  return results
}

function parseNasdaqPipeFile(content, mapLine) {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (!lines.length) {
    return []
  }

  return lines
    .slice(1)
    .filter((line) => !line.startsWith('File Creation Time'))
    .map((line) => line.split('|'))
    .map(mapLine)
    .filter(Boolean)
}

async function fetchMarketUniverse() {
  if (
    marketUniverseCache.data &&
    Date.now() - marketUniverseCache.savedAt < UNIVERSE_TTL_MS
  ) {
    return marketUniverseCache.data
  }

  const [nasdaqResponse, otherResponse] = await Promise.all([
    fetch('https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt'),
    fetch('https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt'),
  ])

  if (!nasdaqResponse.ok || !otherResponse.ok) {
    throw new Error('Could not download market universe.')
  }

  const [nasdaqText, otherText] = await Promise.all([
    nasdaqResponse.text(),
    otherResponse.text(),
  ])

  const nasdaqSymbols = parseNasdaqPipeFile(nasdaqText, (fields) => {
    const symbol = fields[0]
    const name = fields[1]
    const testIssue = fields[6]
    const isEtf = fields[7]

    if (!symbol || testIssue === 'Y' || isEtf === 'Y') {
      return null
    }

    return {
      symbol,
      name,
      exchange: 'NASDAQ',
    }
  })

  const otherSymbols = parseNasdaqPipeFile(otherText, (fields) => {
    const symbol = fields[0]
    const name = fields[1]
    const exchangeCode = fields[2]
    const isEtf = fields[4]
    const testIssue = fields[6]

    if (!symbol || testIssue === 'Y' || isEtf === 'Y') {
      return null
    }

    const exchangeMap = {
      N: 'NYSE',
      A: 'NYSE American',
      P: 'NYSE Arca',
      V: 'IEX',
      Z: 'Cboe',
    }

    return {
      symbol,
      name,
      exchange: exchangeMap[exchangeCode] ?? 'OTHER',
    }
  })

  const merged = [...nasdaqSymbols, ...otherSymbols]
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
    .filter((item, index, arr) => index === 0 || item.symbol !== arr[index - 1].symbol)

  marketUniverseCache = {
    data: merged,
    savedAt: Date.now(),
  }

  return merged
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/stocks', async (req, res) => {
  const symbols = parseSymbols(req.query.symbols)

  if (!symbols.length) {
    res.status(400).json({
      error: 'Enter at least one valid ticker. Example: AAPL, MSFT, NVDA',
    })
    return
  }

  const results = await settleSymbolsWithConcurrency(symbols)

  const data = results
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value)
  const failed = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason?.message)

  res.json({
    data,
    failed,
  })
})

app.get('/api/universe', async (_req, res) => {
  try {
    const data = await fetchMarketUniverse()
    res.json({
      total: data.length,
      data,
    })
  } catch (error) {
    res.status(500).json({
      error:
        error?.message ??
        'Could not load stock universe at the moment.',
    })
  }
})

const server = http.createServer(app)

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.log(
      `Port ${PORT} is already in use. Reusing existing backend process on that port.`
    )
    process.exit(0)
  }

  throw error
})

server.listen(PORT, () => {
  console.log(`Stock API server running on http://localhost:${PORT}`)
})

server.on('close', () => {
  console.log('Stock API server closed.')
})
