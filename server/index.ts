// @ts-nocheck — migrated from JS; tighten types incrementally
import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'

const app = express()
const PORT = Number(process.env.PORT || 9001)
const MAX_SYMBOLS = 120
const SYMBOL_CONCURRENCY = 4
const FETCH_RETRIES = 2
const CACHE_TTL_MS = 5 * 60 * 1000
const MARKET_SNAPSHOT_CACHE_TTL_MS = 20 * 60 * 1000
const SNAPSHOT_BATCH_SIZE = 120
const SNAPSHOT_BATCH_CONCURRENCY = 6
const SNAPSHOT_SYMBOL_CONCURRENCY = 8
const SNAPSHOT_CACHE_FILE = path.join(process.cwd(), '.cache', 'market-snapshot.json')
const PROFILE_CACHE_TTL_MS = 12 * 60 * 60 * 1000
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY?.trim()
const FMP_API_KEY = process.env.FMP_API_KEY?.trim()
const FMP_FUNDAMENTALS_CACHE_TTL_MS = 60 * 60 * 1000
const fmpFundamentalsCache = new Map()

// --- AI provider (provider-agnostic: gemini | claude | groq) ---
const AI_PROVIDER = (process.env.AI_PROVIDER || 'gemini').trim().toLowerCase()
const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim()
const GEMINI_MODEL = (process.env.GEMINI_MODEL || 'gemini-2.0-flash').trim()
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY?.trim()
const CLAUDE_MODEL = (process.env.CLAUDE_MODEL || 'claude-sonnet-4-5').trim()
const GROQ_API_KEY = process.env.GROQ_API_KEY?.trim()
const GROQ_MODEL = (process.env.GROQ_MODEL || 'llama-3.3-70b-versatile').trim()
const TECHNICAL_ANALYSIS_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const technicalAnalysisCache = new Map()
/** Curated fundamentals when public APIs resolve the wrong Wikipedia/Wikidata entity. */
const PROFILE_SYMBOL_OVERRIDES = {
  AXTI: {
    sector: 'Technology',
    industry: 'Semiconductor materials & compound substrates',
    businessSummary:
      'AXT, Inc. designs and manufactures compound semiconductor substrates (GaAs, InP, Ge) and related specialty materials — a niche but strategic link in the global chip and photonics supply chain.',
    dataSource: 'curated',
  },
}
const symbolCache = new Map()
const profileCache = new Map()
const UNIVERSE_TTL_MS = 24 * 60 * 60 * 1000
let marketUniverseCache = { data: null, savedAt: 0 }
let marketSnapshotCache = { data: null, savedAt: 0, failed: [] }
let marketSnapshotBuildPromise = null
let marketSnapshotProgressListeners = []
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

function cleanBusinessSummary(summary = '') {
  return summary.replace(/\s+/g, ' ').trim()
}

/** Rejects Wikipedia summaries that are clearly not a listed company (POI, geography, etc.). */
function looksLikeNonCompanyWikipediaDescription(description = '') {
  const text = description.trim()
  if (!text) return false
  const lower = text.toLowerCase()
  if (
    /^(airport|train station|railway station|station|bridge|dam|river|mountain|building|prefecture|district|university|college|school|hospital|park|museum|highway|road|tunnel|lake|island|town|village|city)\b/i.test(
      text
    )
  ) {
    return true
  }
  if (/\bairport in\b/.test(lower)) return true
  if (/\bstation in\b/.test(lower) && !/\bcompany\b/.test(lower)) return true
  return false
}

function applyProfileOverride(symbol, value) {
  const key = String(symbol ?? '').toUpperCase()
  const override = PROFILE_SYMBOL_OVERRIDES[key]
  if (!override || !value) {
    return value
  }
  return {
    ...value,
    sector: override.sector ?? value.sector,
    industry: override.industry ?? value.industry,
    businessSummary: override.businessSummary ?? value.businessSummary,
    dataSource: override.dataSource ?? value.dataSource,
  }
}

function extractFoundedYear(text = '') {
  const foundedMatch = text.match(
    /\b(?:founded|incorporated|established)\s+(?:in\s+)?((?:18|19|20)\d{2})\b/i
  )
  if (foundedMatch) {
    return Number(foundedMatch[1])
  }

  return null
}

function cleanNameForWiki(name = '') {
  return name
    .replace(/\s*-\s*.*$/, '')
    .replace(
      /\b(inc|inc\.|corp|corporation|co|co\.|holdings|group|limited|ltd|plc|sa|se|nv|ag|company)\b/gi,
      ''
    )
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseWikidataYear(timeValue) {
  if (typeof timeValue !== 'string') {
    return null
  }

  const matched = timeValue.match(/([+-]?\d{4})-/)
  if (!matched) {
    return null
  }

  return Math.abs(Number(matched[1]))
}

function inferSectorFromIndustry(industry = '') {
  const text = industry.toUpperCase()

  if (text.includes('SEMICONDUCTOR') || text.includes('SOFTWARE') || text.includes('TECH')) {
    return 'Technology'
  }
  if (
    text.includes('BANK') ||
    text.includes('FINANC') ||
    text.includes('PAYMENT') ||
    text.includes('INSURANCE')
  ) {
    return 'Financial Services'
  }
  if (text.includes('PHARMA') || text.includes('BIOTECH') || text.includes('HEALTH')) {
    return 'Healthcare'
  }
  if (text.includes('ENERGY') || text.includes('OIL') || text.includes('GAS')) {
    return 'Energy'
  }
  if (
    text.includes('INDUSTR') ||
    text.includes('ALUMIN') ||
    text.includes('MANUFACTUR') ||
    text.includes('AEROSPACE')
  ) {
    return 'Industrials'
  }
  if (
    text.includes('RETAIL') ||
    text.includes('E-COMMERCE') ||
    text.includes('CONSUMER')
  ) {
    return 'Consumer'
  }

  return 'Unknown'
}

function extractTickerClaims(entity) {
  const claims = entity?.claims?.P249 ?? []
  return claims
    .map((claim) => claim?.mainsnak?.datavalue?.value)
    .filter(Boolean)
    .map((value) => String(value).toUpperCase())
}

function extractIndustryEntityIds(entity) {
  const claims = entity?.claims?.P452 ?? []
  return claims
    .map((claim) => claim?.mainsnak?.datavalue?.value?.id)
    .filter(Boolean)
}

function extractInceptionYear(entity) {
  const claim = entity?.claims?.P571?.[0]
  const time = claim?.mainsnak?.datavalue?.value?.time
  return parseWikidataYear(time)
}

function extractEnWikipediaTitle(entity) {
  return entity?.sitelinks?.enwiki?.title ?? null
}

async function fetchWikipediaSummaryByTitle(title) {
  const endpoint =
    'https://en.wikipedia.org/api/rest_v1/page/summary/' +
    encodeURIComponent(title.replaceAll(' ', '_'))
  const response = await fetchWithTimeout(
    endpoint,
    {
      headers: {
        'User-Agent': 'stock-info-local-app/1.0',
        Accept: 'application/json',
      },
    },
    8000
  )

  if (!response.ok) {
    throw new Error(`Wikipedia HTTP ${response.status}`)
  }

  const payload = await response.json()
  return {
    description: cleanBusinessSummary(payload.description ?? ''),
    extract: cleanBusinessSummary(payload.extract ?? ''),
  }
}

async function fetchWikidataEntityById(entityId) {
  const endpoint = `https://www.wikidata.org/wiki/Special:EntityData/${entityId}.json`
  const response = await fetchWithTimeout(
    endpoint,
    {
      headers: {
        'User-Agent': 'stock-info-local-app/1.0',
        Accept: 'application/json',
      },
    },
    10000
  )

  if (!response.ok) {
    throw new Error(`Wikidata entity HTTP ${response.status}`)
  }

  const payload = await response.json()
  return payload?.entities?.[entityId] ?? null
}

async function fetchWikidataLabelsByIds(ids) {
  if (!ids.length) {
    return {}
  }

  const endpoint =
    'https://www.wikidata.org/w/api.php?' +
    new URLSearchParams({
      action: 'wbgetentities',
      format: 'json',
      ids: ids.join('|'),
      languages: 'en',
      props: 'labels',
      origin: '*',
    }).toString()

  const response = await fetchWithTimeout(
    endpoint,
    {
      headers: {
        'User-Agent': 'stock-info-local-app/1.0',
        Accept: 'application/json',
      },
    },
    10000
  )

  if (!response.ok) {
    throw new Error(`Wikidata labels HTTP ${response.status}`)
  }

  const payload = await response.json()
  const result = {}
  for (const id of ids) {
    result[id] = payload?.entities?.[id]?.labels?.en?.value ?? null
  }
  return result
}

function buildWikiCandidates(companyName = '') {
  const raw = companyName.replace(/\s*-\s*.*$/, '').trim()
  const cleaned = cleanNameForWiki(raw)

  return Array.from(
    new Set(
      [raw, `${raw} (company)`, cleaned, `${cleaned} (company)`].filter((value) =>
        value?.trim()
      )
    )
  )
}

function inferSectorIndustry(text = '') {
  const source = text.toUpperCase()
  const has = (tokens) => tokens.some((token) => source.includes(token))

  if (has(['SEMICONDUCTOR', 'CHIP', 'MICROPROCESSOR'])) {
    return { sector: 'Technology', industry: 'Semiconductors' }
  }
  if (has(['BANK', 'FINTECH', 'PAYMENT', 'INSURANCE', 'FINANCIAL'])) {
    return { sector: 'Financial Services', industry: 'Financials / Fintech' }
  }
  if (has(['PHARM', 'BIOTECH', 'HEALTHCARE', 'MEDICAL'])) {
    return { sector: 'Healthcare', industry: 'Biotech / Healthcare' }
  }
  if (has(['OIL', 'GAS', 'ENERGY', 'PETROLEUM', 'RENEWABLE'])) {
    return { sector: 'Energy', industry: 'Energy' }
  }
  if (has(['SOFTWARE', 'CLOUD', 'INTERNET', 'PLATFORM', 'SAAS'])) {
    return { sector: 'Technology', industry: 'Software / Internet' }
  }
  if (has(['AEROSPACE', 'INDUSTRIAL', 'ALUMINUM', 'STEEL', 'MACHINERY'])) {
    return { sector: 'Industrials', industry: 'Industrial Manufacturing' }
  }
  if (has(['RETAIL', 'CONSUMER', 'E-COMMERCE', 'FOOD', 'BEVERAGE'])) {
    return { sector: 'Consumer', industry: 'Consumer Goods / Services' }
  }

  return { sector: null, industry: null }
}

function unwrapFmpFirstRow(payload) {
  if (Array.isArray(payload) && payload.length) {
    return payload[0]
  }
  return null
}

function normalizeFmpDcf(payload) {
  if (Array.isArray(payload) && payload.length) {
    return payload[0]
  }
  if (payload && typeof payload === 'object' && Object.keys(payload).length) {
    return payload
  }
  return null
}

async function fetchFmpFundamentalsBundle(symbol) {
  const upper = symbol.toUpperCase()
  const requests = [
    ['profile', '/profile', {}],
    ['keyMetricsTtm', '/key-metrics-ttm', {}],
    ['ratiosTtm', '/ratios-ttm', {}],
    ['incomeStatement', '/income-statement', { limit: 5 }],
    ['balanceSheet', '/balance-sheet-statement', { limit: 5 }],
    ['cashFlow', '/cash-flow-statement', { limit: 5 }],
    ['dcf', '/discounted-cash-flow', {}],
  ]

  const settled = await Promise.all(
    requests.map(async ([key, path, params]) => {
      try {
        const data = await fetchFmpStableJson(path, { symbol: upper, ...params })
        return [key, { ok: true, data }]
      } catch (error) {
        return [key, { ok: false, error: error?.message ?? String(error) }]
      }
    })
  )

  const map = Object.fromEntries(settled)

  return {
    symbol: upper,
    dataSource: 'financialmodelingprep.com (stable)',
    profile: map.profile?.ok ? unwrapFmpFirstRow(map.profile.data) : null,
    profileError: map.profile?.ok ? null : map.profile?.error,
    keyMetricsTtm: map.keyMetricsTtm?.ok ? unwrapFmpFirstRow(map.keyMetricsTtm.data) : null,
    keyMetricsTtmError: map.keyMetricsTtm?.ok ? null : map.keyMetricsTtm?.error,
    ratiosTtm: map.ratiosTtm?.ok ? unwrapFmpFirstRow(map.ratiosTtm.data) : null,
    ratiosTtmError: map.ratiosTtm?.ok ? null : map.ratiosTtm?.error,
    incomeStatementAnnual: map.incomeStatement?.ok && Array.isArray(map.incomeStatement.data)
      ? map.incomeStatement.data
      : [],
    incomeStatementError: map.incomeStatement?.ok ? null : map.incomeStatement?.error,
    balanceSheetAnnual: map.balanceSheet?.ok && Array.isArray(map.balanceSheet.data)
      ? map.balanceSheet.data
      : [],
    balanceSheetError: map.balanceSheet?.ok ? null : map.balanceSheet?.error,
    cashFlowAnnual: map.cashFlow?.ok && Array.isArray(map.cashFlow.data)
      ? map.cashFlow.data
      : [],
    cashFlowError: map.cashFlow?.ok ? null : map.cashFlow?.error,
    discountedCashFlow: map.dcf?.ok ? normalizeFmpDcf(map.dcf.data) : null,
    discountedCashFlowError: map.dcf?.ok ? null : map.dcf?.error,
  }
}

// ------------------------------------------------------------------
// Technical analysis — OHLCV fetch, indicators, AI narrative
// ------------------------------------------------------------------

const FMP_STABLE_BASE = 'https://financialmodelingprep.com/stable'

async function fetchFmpStableJson(path, params = {}) {
  if (!FMP_API_KEY) {
    throw new Error('FMP_API_KEY is not configured')
  }

  const url = new URL(`${FMP_STABLE_BASE}${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }
  url.searchParams.set('apikey', FMP_API_KEY)

  const response = await fetchWithTimeout(
    url.toString(),
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'stock-info-local-app/1.0',
      },
    },
    20000
  )

  const text = await response.text()
  let payload = null
  let parseError = null
  try {
    payload = JSON.parse(text)
  } catch (error) {
    parseError = error
  }

  if (!response.ok) {
    if (response.status === 402) {
      throw new Error(`FMP subscription required (HTTP 402): ${text.trim().slice(0, 220)}`)
    }
    const message =
      payload?.['Error Message'] ??
      payload?.message ??
      (text ? text.trim().slice(0, 220) : `FMP HTTP ${response.status}`)
    throw new Error(message)
  }

  if (parseError) {
    throw new Error(`FMP returned non-JSON (HTTP ${response.status}): ${text.trim().slice(0, 220)}`)
  }

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    if (payload['Error Message']) {
      throw new Error(payload['Error Message'])
    }
  }

  return payload
}

function normalizeOhlcvRows(rows) {
  return [...rows]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((row) => ({
      date: String(row.date).slice(0, 10),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close ?? row.adjClose),
      volume: Number(row.volume ?? 0),
    }))
    .filter(
      (row) =>
        Number.isFinite(row.open) &&
        Number.isFinite(row.high) &&
        Number.isFinite(row.low) &&
        Number.isFinite(row.close)
    )
}

async function fetchOhlcvFromFmp(symbol, { lookbackDays = 260 } = {}) {
  if (!FMP_API_KEY) {
    throw new Error('FMP_API_KEY is not configured')
  }

  const upper = symbol.toUpperCase()
  const fromDate = new Date()
  fromDate.setDate(fromDate.getDate() - lookbackDays - 30)
  const from = fromDate.toISOString().slice(0, 10)

  const payload = await withRetries(
    async () =>
      fetchFmpStableJson('/historical-price-eod/full', {
        symbol: upper,
        from,
      }),
    1
  )
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.historical)
      ? payload.historical
      : []

  if (rows.length < 30) {
    throw new Error(
      `FMP returned only ${rows.length} OHLCV rows for ${symbol} (need 30+ for indicators).`
    )
  }
  return normalizeOhlcvRows(rows)
}

async function fetchOhlcvFromYahoo(symbol, { lookbackDays = 260 } = {}) {
  const yahooTicker = toYahooTicker(symbol)
  const range = lookbackDays > 365 ? '2y' : lookbackDays > 180 ? '1y' : '6mo'
  const hosts = [
    'https://query1.finance.yahoo.com',
    'https://query2.finance.yahoo.com',
  ]

  let lastError = null
  for (const host of hosts) {
    try {
      return await withYahooHttpRetries(
        async () => {
          await paceYahooRequest()
          const endpoint =
            `${host}/v8/finance/chart/${encodeURIComponent(yahooTicker)}` +
            `?range=${range}&interval=1d&events=div,splits&includePrePost=false`
          const response = await fetchWithTimeout(
            endpoint,
            { headers: YAHOO_HTTP_HEADERS },
            12000
          )

          if (response.status === 429) {
            const err = new Error('Yahoo HTTP 429')
            const ra = parseRetryAfterMs(response)
            if (ra != null) {
              err.backoffMs = ra
            }
            throw err
          }

          if (!response.ok) {
            throw new Error(`Yahoo HTTP ${response.status}`)
          }

          const payload = await response.json()
          const yahooError = payload?.chart?.error?.description
          if (yahooError) {
            throw new Error(yahooError)
          }

          const result = payload?.chart?.result?.[0]
          const quote = result?.indicators?.quote?.[0]
          const timestamps = result?.timestamp

          if (!Array.isArray(timestamps) || !quote) {
            throw new Error(`Yahoo returned no chart data for ${symbol}`)
          }

          const candles = []
          for (let i = 0; i < timestamps.length; i += 1) {
            const o = Number(quote.open?.[i])
            const h = Number(quote.high?.[i])
            const l = Number(quote.low?.[i])
            const c = Number(quote.close?.[i])
            const v = Number(quote.volume?.[i])
            if (
              Number.isFinite(o) &&
              Number.isFinite(h) &&
              Number.isFinite(l) &&
              Number.isFinite(c)
            ) {
              candles.push({
                date: formatIsoDateFromUnix(timestamps[i]),
                open: o,
                high: h,
                low: l,
                close: c,
                volume: Number.isFinite(v) ? v : 0,
              })
            }
          }

          if (candles.length < 30) {
            throw new Error(
              `Yahoo returned only ${candles.length} OHLCV rows for ${symbol} (need 30+).`
            )
          }
          return candles
        },
        { shouldRetry: isYahooRetryableError }
      )
    } catch (error) {
      lastError = error
    }
  }

  throw new Error(
    `Yahoo OHLCV fetch failed for ${symbol}: ${lastError?.message ?? 'unknown error'}`
  )
}

/**
 * Tries FMP first (better data, especially adjusted closes), then Yahoo as fallback.
 * Returns { candles, dataSource, fmpError? } so the endpoint can surface the source used.
 */
async function fetchOhlcv(symbol, options = {}) {
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

function sma(values, period) {
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
function rsi(values, period = 14) {
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
function detectSupportResistance(candles, currentPrice, { window = 5, lookback = 120 } = {}) {
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

function averageVolume(candles, period) {
  if (candles.length < period) return null
  const recent = candles.slice(-period)
  const sum = recent.reduce((acc, c) => acc + (Number.isFinite(c.volume) ? c.volume : 0), 0)
  return sum / period
}

function computeTechnicalSnapshot(symbol, candles) {
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

function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : 'N/A'
}

function buildSmaSeries(candles, period) {
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

/**
 * Generates a server-side candlestick PNG via QuickChart.io.
 * Returns the image as a base64 string. Throws on failure (caller decides to degrade).
 */
async function generateCandleChartPng(symbol, candles, { supports = [], resistances = [] } = {}) {
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

function buildTechnicalAnalysisPrompt(snapshot, { withImage = false } = {}) {
  const { indicators: i, supports, resistances, recentCandles } = snapshot
  const supportStr = supports.length
    ? supports.map((s) => `$${formatNumber(s.level)} (${s.touches} toques)`).join(', ')
    : 'ninguno claro'
  const resistanceStr = resistances.length
    ? resistances.map((r) => `$${formatNumber(r.level)} (${r.touches} toques)`).join(', ')
    : 'ninguna clara'

  const candlesTable = recentCandles
    .map(
      (c) =>
        `${c.date}: O=${formatNumber(c.open)} H=${formatNumber(c.high)} L=${formatNumber(c.low)} C=${formatNumber(c.close)} Vol=${c.volume}`
    )
    .join('\n')

  const imageNote = withImage
    ? `
ADEMÁS se adjunta una IMAGEN del gráfico de velas diario (últimas 90 barras) con SMA 20 y SMA 50 como líneas superpuestas y los soportes/resistencias dibujados como líneas punteadas. Usá la imagen como contexto visual: identificá patrones gráficos (HCH, doble techo/piso, banderas, triángulos, cruces de medias) y la forma global del precio. Combiná eso con la precisión numérica de los datos de abajo.`
    : ''

  return `Sos un analista técnico experto. Analizá los siguientes datos de ${snapshot.symbol} al ${snapshot.asOf}.${imageNote}

INDICADORES CALCULADOS:
- Precio actual: $${formatNumber(snapshot.currentPrice)}
- Cambio diario: ${formatNumber(i.dayChange)}%
- Cambio mensual: ${formatNumber(i.monthChange)}%
- SMA 20: $${formatNumber(i.sma20)}
- SMA 50: $${formatNumber(i.sma50)}
- SMA 200: $${formatNumber(i.sma200)}
- RSI 14: ${formatNumber(i.rsi14)}
- Volumen promedio 20d vs 60d: ${formatNumber(i.volumeTrendPct)}%
- Soportes detectados: ${supportStr}
- Resistencias detectadas: ${resistanceStr}

ÚLTIMAS 30 VELAS DIARIAS (OHLCV):
${candlesTable}

Devolvé ÚNICAMENTE un JSON válido (sin markdown, sin \`\`\`) con esta forma exacta:
{
  "trend": "uptrend" | "downtrend" | "sideways",
  "trendStrength": "weak" | "moderate" | "strong",
  "rsiReading": "oversold" | "neutral" | "overbought",
  "momentum": "bullish" | "bearish" | "neutral",
  "keyObservations": ["obs 1", "obs 2", "obs 3"],
  "patterns": ["patrón 1 si existe, ej: bandera alcista, doble techo, HCH, cruce dorado"],
  "narrative": "Párrafo en español (máx 4 oraciones) describiendo lo que muestra el gráfico. SOLO descripción técnica.",
  "riskFlags": ["factor de riesgo 1", "factor de riesgo 2"]
}

REGLAS CRÍTICAS:
1. Jamás incluyas consejo direccional ("comprar", "vender", "mantener", "es buena oportunidad"). Solo descripción técnica neutra.
2. Todo el texto ("keyObservations", "patterns", "narrative", "riskFlags") debe estar en español.
3. Si no hay patrón claro, "patterns" puede ser array vacío [].
4. No inventes niveles que no estén en los datos.
5. Respondé SOLO el JSON, sin texto extra.`
}

async function callGeminiAnalysis(prompt, { imageBase64 = null } = {}) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured')
  }

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent` +
    `?key=${encodeURIComponent(GEMINI_API_KEY)}`

  const parts = [{ text: prompt }]
  if (imageBase64) {
    parts.push({
      inline_data: { mime_type: 'image/png', data: imageBase64 },
    })
  }

  const response = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      }),
    },
    45000
  )

  const text = await response.text()
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error(
        `Gemini quota agotada (HTTP 429). Free tier: 15 requests/min · 1500 requests/día. ` +
          `Esperá unos minutos y volvé a clickear, o cambiá AI_PROVIDER=groq en .env como alternativa free.`
      )
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Gemini auth error (HTTP ${response.status}). Verificá que GEMINI_API_KEY sea válida en aistudio.google.com/apikey.`
      )
    }
    throw new Error(`Gemini HTTP ${response.status}: ${text.slice(0, 200)}`)
  }

  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('Gemini returned non-JSON body')
  }

  const rawText = payload?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  if (!rawText.trim()) {
    throw new Error('Gemini returned empty content')
  }

  return { rawText, model: GEMINI_MODEL, provider: 'gemini', imageUsed: Boolean(imageBase64) }
}

async function callClaudeAnalysis(prompt, { imageBase64 = null } = {}) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured')
  }

  const content = []
  if (imageBase64) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: imageBase64 },
    })
  }
  content.push({ type: 'text', text: prompt })

  const response = await fetchWithTimeout(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        temperature: 0.2,
        messages: [{ role: 'user', content }],
      }),
    },
    45000
  )

  const text = await response.text()
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error(
        `Claude rate limit (HTTP 429). Esperá un momento y reintentá, o cambiá a Gemini/Groq mientras tanto.`
      )
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Claude auth error (HTTP ${response.status}). Verificá tu ANTHROPIC_API_KEY.`
      )
    }
    throw new Error(`Claude HTTP ${response.status}: ${text.slice(0, 200)}`)
  }

  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('Claude returned non-JSON body')
  }

  const rawText = payload?.content?.[0]?.text ?? ''
  if (!rawText.trim()) {
    throw new Error('Claude returned empty content')
  }

  return { rawText, model: CLAUDE_MODEL, provider: 'claude', imageUsed: Boolean(imageBase64) }
}

async function callGroqAnalysis(prompt, { imageBase64 = null } = {}) {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not configured')
  }

  // Llama 3.3 70B (default) is text-only; drop the image silently rather than fail.
  // If user swaps GROQ_MODEL to a vision model (e.g. llama-4-scout), pass the image.
  const modelIsVision = /vision|scout|maverick|mm/.test(GROQ_MODEL.toLowerCase())
  const content = modelIsVision && imageBase64
    ? [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
      ]
    : prompt

  const response = await fetchWithTimeout(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content }],
      }),
    },
    45000
  )

  const text = await response.text()
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error(
        `Groq rate limit (HTTP 429). Free tier: ~30 req/min. Esperá un minuto y reintentá.`
      )
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Groq auth error (HTTP ${response.status}). Verificá tu GROQ_API_KEY en console.groq.com/keys.`
      )
    }
    throw new Error(`Groq HTTP ${response.status}: ${text.slice(0, 200)}`)
  }

  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('Groq returned non-JSON body')
  }

  const rawText = payload?.choices?.[0]?.message?.content ?? ''
  if (!rawText.trim()) {
    throw new Error('Groq returned empty content')
  }

  return {
    rawText,
    model: GROQ_MODEL,
    provider: 'groq',
    imageUsed: Boolean(imageBase64) && modelIsVision,
  }
}

function hasAnyAiKey() {
  return Boolean(GEMINI_API_KEY || ANTHROPIC_API_KEY || GROQ_API_KEY)
}

function resolveActiveAiProvider() {
  if (AI_PROVIDER === 'claude' && ANTHROPIC_API_KEY) return 'claude'
  if (AI_PROVIDER === 'groq' && GROQ_API_KEY) return 'groq'
  if (AI_PROVIDER === 'gemini' && GEMINI_API_KEY) return 'gemini'
  if (GEMINI_API_KEY) return 'gemini'
  if (GROQ_API_KEY) return 'groq'
  if (ANTHROPIC_API_KEY) return 'claude'
  return null
}

async function callAiAnalysis(prompt, options = {}) {
  const provider = resolveActiveAiProvider()
  if (!provider) {
    throw new Error('No AI API key configured (set GEMINI_API_KEY, GROQ_API_KEY, or ANTHROPIC_API_KEY)')
  }

  if (provider === 'claude') return callClaudeAnalysis(prompt, options)
  if (provider === 'groq') return callGroqAnalysis(prompt, options)
  return callGeminiAnalysis(prompt, options)
}

function stripJsonCodeFence(text = '') {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim()
}

function parseAiAnalysisJson(rawText) {
  const cleaned = stripJsonCodeFence(rawText)
  try {
    return JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        return JSON.parse(match[0])
      } catch {
        return null
      }
    }
    return null
  }
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

function parseRetryAfterMs(response) {
  if (!response) {
    return null
  }
  const raw = response.headers.get('Retry-After')?.trim()
  if (!raw) {
    return null
  }
  const asInt = parseInt(raw, 10)
  if (Number.isFinite(asInt) && asInt >= 0) {
    if (asInt < 200) {
      return Math.min(120_000, asInt * 1000)
    }
    return Math.min(120_000, asInt)
  }
  const asDate = Date.parse(raw)
  if (Number.isFinite(asDate)) {
    return Math.max(0, Math.min(120_000, asDate - Date.now()))
  }
  return null
}

const YAHOO_MIN_REQUEST_GAP_MS = 400
let yahooNextSlotAt = 0

async function paceYahooRequest() {
  const now = Date.now()
  const delay = Math.max(0, yahooNextSlotAt - now)
  if (delay > 0) {
    await wait(delay)
  }
  yahooNextSlotAt = Date.now() + YAHOO_MIN_REQUEST_GAP_MS
}

/**
 * Retries for Yahoo rate limits (HTTP 429) and transient 5xx with exponential backoff.
 * @param {() => Promise<unknown>} operation
 * @param {{ shouldRetry?: (e: Error) => boolean }} [options]
 */
async function withYahooHttpRetries(
  operation,
  { shouldRetry = () => true, maxAttempts = 6, baseMs = 1600, maxMs = 60_000 } = {}
) {
  let lastError
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      const e = error instanceof Error ? error : new Error(String(error))
      const retryable = shouldRetry(e)
      if (attempt === maxAttempts - 1 || !retryable) {
        throw e
      }
      const custom = 'backoffMs' in e && typeof e.backoffMs === 'number' ? e.backoffMs : null
      const exp = Math.min(maxMs, baseMs * 2 ** attempt)
      const delayMs = custom != null && Number.isFinite(custom) ? Math.min(maxMs, custom) : exp
      await wait(delayMs)
    }
  }
  throw lastError
}

function isYahooRetryableError(error) {
  const m = error?.message ?? ''
  if (/Yahoo HTTP (429|502|503|504)/.test(m)) {
    return true
  }
  if (m.includes('Yahoo') && m.includes('fetch failed')) {
    return true
  }
  return false
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

/**
 * Daily closes in chronological order (oldest → newest). Null/NaN entries are allowed between valid closes.
 */
function buildStockFromSortedDailyCloses(symbol, closes, updatedAtRaw) {
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

  // Fresh IPOs may have only 1 close. Return what we can and leave % changes as null
  // — the frontend formatter renders null as 'N/A' instead of crashing.
  const previousClose =
    latestIndex >= 1 ? findCloseAtOrBefore(closes, latestIndex - 1) : null
  const monthClose =
    latestIndex >= 1 ? findCloseAtOrBefore(closes, Math.max(latestIndex - 21, 0)) : null
  const yearClose =
    latestIndex >= 1 ? findCloseAtOrBefore(closes, Math.max(latestIndex - 252, 0)) : null

  let updatedAt = ''
  if (updatedAtRaw != null) {
    updatedAt = String(updatedAtRaw).slice(0, 10)
  }

  return {
    symbol,
    price: latestClose,
    updatedAt,
    dayChange: Number.isFinite(previousClose) ? toPercent(latestClose, previousClose) : null,
    monthChange: Number.isFinite(monthClose) ? toPercent(latestClose, monthClose) : null,
    yearChange: Number.isFinite(yearClose) ? toPercent(latestClose, yearClose) : null,
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
  if (latestIndex < 0) {
    throw new Error(`Not enough historical data for ${symbol}.`)
  }

  return buildStockFromSortedDailyCloses(
    symbol,
    closes,
    formatIsoDateFromUnix(timestamps[latestIndex])
  )
}

async function fetchSymbolDataFromFmp(symbol) {
  if (!FMP_API_KEY) {
    throw new Error('FMP_API_KEY is not configured')
  }

  const upper = symbol.toUpperCase()
  const twoYearsAgo = new Date()
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)
  const from = twoYearsAgo.toISOString().slice(0, 10)

  const payload = await withRetries(
    async () =>
      fetchFmpStableJson('/historical-price-eod/full', {
        symbol: upper,
        from,
      }),
    1
  )

  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.historical)
      ? payload.historical
      : []

  if (rows.length < 3) {
    throw new Error(`FMP returned insufficient rows for ${symbol}`)
  }

  const sorted = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const closes = sorted.map((row) => Number(row.close ?? row.adjClose))
  const latestRow = sorted[sorted.length - 1]

  return buildStockFromSortedDailyCloses(symbol, closes, latestRow?.date)
}

const YAHOO_HTTP_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
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
      return await withYahooHttpRetries(
        async () => {
          await paceYahooRequest()
          const endpoint =
            `${host}/v8/finance/chart/${encodeURIComponent(yahooTicker)}` +
            '?range=2y&interval=1d&events=div,splits&includePrePost=false'
          const response = await fetchWithTimeout(
            endpoint,
            { headers: YAHOO_HTTP_HEADERS },
            12000
          )

          if (response.status === 429) {
            const err = new Error('Yahoo HTTP 429')
            const ra = parseRetryAfterMs(response)
            if (ra != null) {
              err.backoffMs = ra
            }
            throw err
          }

          if (!response.ok) {
            const { status } = response
            if (status === 502 || status === 503 || status === 504) {
              throw new Error(`Yahoo HTTP ${status}`)
            }
            throw new Error(`Yahoo HTTP ${status}`)
          }

          const payload = await response.json()
          const yahooError = payload?.chart?.error?.description
          if (yahooError) {
            throw new Error(yahooError)
          }

          return buildStockFromYahoo(symbol, payload)
        },
        { shouldRetry: isYahooRetryableError }
      )
    } catch (error) {
      lastError = error
    }
  }

  throw new Error(
    `Yahoo fetch failed for ${symbol}: ${lastError?.message ?? 'unknown error'}`
  )
}

async function fetchCompanyProfileFromYahoo(symbol) {
  const yahooTicker = toYahooTicker(symbol)
  const hosts = [
    'https://query1.finance.yahoo.com',
    'https://query2.finance.yahoo.com',
  ]

  let lastError = null

  for (const host of hosts) {
    try {
      const value = await withYahooHttpRetries(
        async () => {
          await paceYahooRequest()
          const endpoint =
            `${host}/v10/finance/quoteSummary/${encodeURIComponent(yahooTicker)}` +
            '?modules=assetProfile,price'
          const response = await fetchWithTimeout(
            endpoint,
            { headers: YAHOO_HTTP_HEADERS },
            12000
          )

          if (response.status === 429) {
            const err = new Error('Yahoo HTTP 429')
            const ra = parseRetryAfterMs(response)
            if (ra != null) {
              err.backoffMs = ra
            }
            throw err
          }

          if (!response.ok) {
            const { status } = response
            if (status === 502 || status === 503 || status === 504) {
              throw new Error(`Yahoo HTTP ${status}`)
            }
            throw new Error(`Yahoo HTTP ${status}`)
          }

          const payload = await response.json()
          const profileError = payload?.quoteSummary?.error?.description
          if (profileError) {
            throw new Error(profileError)
          }

          const result = payload?.quoteSummary?.result?.[0]
          const assetProfile = result?.assetProfile ?? {}
          const price = result?.price ?? {}
          const summary = cleanBusinessSummary(assetProfile.longBusinessSummary ?? '')
          const foundedYear = extractFoundedYear(summary)
          const listedEpoch =
            Number(price.firstTradeDateEpochUtc) ||
            Number(price.firstTradeDateMilliseconds) / 1000
          const listedYear = Number.isFinite(listedEpoch)
            ? new Date(listedEpoch * 1000).getUTCFullYear()
            : null
          const startYear = foundedYear ?? listedYear
          const currentYear = new Date().getUTCFullYear()
          const yearsOperating =
            Number.isFinite(startYear) && startYear > 1800
              ? Math.max(1, currentYear - startYear)
              : null

          return {
            symbol,
            sector: assetProfile.sector ?? null,
            industry: assetProfile.industry ?? null,
            businessSummary: summary || null,
            foundedYear,
            listedYear,
            yearsOperating,
            yearsSource: foundedYear ? 'founded' : listedYear ? 'listed' : null,
            dataSource: 'yahoo',
          }
        },
        { shouldRetry: isYahooRetryableError }
      )

      return value
    } catch (error) {
      lastError = error
    }
  }

  throw new Error(
    `Profile fetch failed for ${symbol}: ${lastError?.message ?? 'unknown error'}`
  )
}

async function fetchCompanyProfileFromFinnhub(symbol) {
  if (!FINNHUB_API_KEY) {
    throw new Error('Finnhub API key is not configured')
  }

  const endpoint =
    'https://finnhub.io/api/v1/stock/profile2?' +
    new URLSearchParams({
      symbol,
      token: FINNHUB_API_KEY,
    }).toString()
  const response = await fetchWithTimeout(
    endpoint,
    {
      headers: {
        'User-Agent': 'stock-info-local-app/1.0',
        Accept: 'application/json',
      },
    },
    10000
  )

  if (!response.ok) {
    throw new Error(`Finnhub HTTP ${response.status}`)
  }

  const payload = await response.json()
  if (!payload || typeof payload !== 'object' || !Object.keys(payload).length) {
    throw new Error(`Finnhub profile not found for ${symbol}`)
  }

  const industry = cleanBusinessSummary(payload.finnhubIndustry ?? '') || null
  const listedYear = payload.ipo?.slice(0, 4) ? Number(payload.ipo.slice(0, 4)) : null
  const currentYear = new Date().getUTCFullYear()
  const yearsOperating =
    Number.isFinite(listedYear) && listedYear > 1800
      ? Math.max(1, currentYear - listedYear)
      : null
  const sector = industry ? inferSectorFromIndustry(industry) : 'Unknown'

  return {
    symbol,
    companyName: payload.name ?? null,
    sector: sector || 'Unknown',
    industry: industry || 'Unknown',
    businessSummary: null,
    foundedYear: null,
    listedYear,
    yearsOperating,
    yearsSource: listedYear ? 'listed' : null,
    dataSource: 'finnhub',
  }
}

async function fetchCompanyProfileFromWikipedia(symbol, companyName) {
  const candidates = buildWikiCandidates(companyName)

  let lastError = null

  for (const candidate of candidates) {
    try {
      const endpoint =
        'https://en.wikipedia.org/api/rest_v1/page/summary/' +
        encodeURIComponent(candidate.replaceAll(' ', '_'))
      const response = await fetchWithTimeout(
        endpoint,
        {
          headers: {
            'User-Agent': 'stock-info-local-app/1.0',
            Accept: 'application/json',
          },
        },
        8000
      )

      if (!response.ok) {
        throw new Error(`Wikipedia HTTP ${response.status}`)
      }

      const payload = await response.json()
      const extract = cleanBusinessSummary(payload.extract ?? '')
      const description = cleanBusinessSummary(payload.description ?? '')
      const lowerDescription = description.toLowerCase()
      const likelyWrongEntity =
        companyName?.toLowerCase().includes('inc') &&
        (lowerDescription.includes('fruit') || lowerDescription.includes('species'))
      if (likelyWrongEntity) {
        throw new Error('Wrong Wikipedia entity match')
      }
      if (looksLikeNonCompanyWikipediaDescription(description)) {
        throw new Error('Wikipedia matched a non-company entity')
      }

      const text = `${description}. ${extract}`.trim()
      const foundedYear = extractFoundedYear(text)
      const yearsOperating = foundedYear
        ? Math.max(1, new Date().getUTCFullYear() - foundedYear)
        : null
      const inferred = inferSectorIndustry(text)

      return {
        symbol,
        sector: inferred.sector || 'Unknown',
        industry: inferred.industry || description || 'Unknown',
        businessSummary: extract || null,
        foundedYear,
        listedYear: null,
        yearsOperating,
        yearsSource: foundedYear ? 'founded' : null,
        dataSource: 'wikipedia',
      }
    } catch (error) {
      lastError = error
    }
  }

  throw new Error(
    `Wikipedia profile failed for ${symbol}: ${lastError?.message ?? 'unknown error'}`
  )
}

async function fetchCompanyProfileFromWikidata(symbol, companyName) {
  const queryName = cleanNameForWiki(companyName) || symbol
  const searchEndpoint =
    'https://www.wikidata.org/w/api.php?' +
    new URLSearchParams({
      action: 'wbsearchentities',
      format: 'json',
      language: 'en',
      type: 'item',
      limit: '6',
      search: queryName,
      origin: '*',
    }).toString()

  const searchResponse = await fetchWithTimeout(
    searchEndpoint,
    {
      headers: {
        'User-Agent': 'stock-info-local-app/1.0',
        Accept: 'application/json',
      },
    },
    10000
  )

  if (!searchResponse.ok) {
    throw new Error(`Wikidata search HTTP ${searchResponse.status}`)
  }

  const searchPayload = await searchResponse.json()
  const candidates = searchPayload?.search ?? []
  if (!candidates.length) {
    throw new Error('No Wikidata entity candidates found')
  }

  const detailedCandidates = []
  for (const candidate of candidates) {
    const entity = await fetchWikidataEntityById(candidate.id)
    if (!entity) {
      continue
    }
    const tickers = extractTickerClaims(entity)
    const description = entity?.descriptions?.en?.value ?? candidate.description ?? ''
    const label = entity?.labels?.en?.value ?? candidate.label ?? ''

    const isLikelyCompany = description.toLowerCase().includes('company')
    let score = 0
    if (tickers.includes(symbol.toUpperCase())) {
      score += 8
    }
    if (isLikelyCompany) {
      score += 2
    }
    if (label.toLowerCase().includes(queryName.toLowerCase().split(' ')[0] ?? '')) {
      score += 1
    }

    if (tickers.includes(symbol.toUpperCase()) || isLikelyCompany) {
      detailedCandidates.push({
        score,
        candidate,
        entity,
      })
    }
  }

  if (!detailedCandidates.length) {
    throw new Error('No detailed Wikidata candidate found')
  }

  detailedCandidates.sort((a, b) => b.score - a.score)
  const selected = detailedCandidates[0].entity
  const inceptionYear = extractInceptionYear(selected)
  const industryIds = extractIndustryEntityIds(selected)
  const industryLabels = await fetchWikidataLabelsByIds(industryIds.slice(0, 3))
  const industry =
    industryLabels[industryIds[0]] ??
    selected?.descriptions?.en?.value ??
    detailedCandidates[0].candidate?.description ??
    'Unknown'
  const sector = inferSectorFromIndustry(industry)

  const enWikiTitle = extractEnWikipediaTitle(selected)
  let summary = null
  if (enWikiTitle) {
    try {
      const wiki = await fetchWikipediaSummaryByTitle(enWikiTitle)
      summary = wiki.extract || wiki.description || null
    } catch {
      summary = selected?.descriptions?.en?.value ?? null
    }
  } else {
    summary = selected?.descriptions?.en?.value ?? null
  }

  return {
    symbol,
    sector: sector || 'Unknown',
    industry: industry || 'Unknown',
    businessSummary: summary ? cleanBusinessSummary(summary) : null,
    foundedYear: inceptionYear,
    listedYear: null,
    yearsOperating: inceptionYear
      ? Math.max(1, new Date().getUTCFullYear() - inceptionYear)
      : null,
    yearsSource: inceptionYear ? 'founded' : null,
    dataSource: 'wikidata',
  }
}

async function fetchCompanyProfile(symbol, companyName) {
  const cached = profileCache.get(symbol)
  if (cached && Date.now() - cached.savedAt < PROFILE_CACHE_TTL_MS) {
    return applyProfileOverride(symbol, cached.value)
  }

  let value
  const companyNameHint = companyName ?? symbol

  if (FINNHUB_API_KEY) {
    try {
      value = await fetchCompanyProfileFromFinnhub(symbol)
      try {
        const wiki = await fetchCompanyProfileFromWikipedia(
          symbol,
          value.companyName ?? companyNameHint
        )
        value = {
          ...value,
          sector: value.sector === 'Unknown' ? wiki.sector : value.sector,
          industry: value.industry === 'Unknown' ? wiki.industry : value.industry,
          businessSummary: wiki.businessSummary ?? value.businessSummary,
          foundedYear: value.foundedYear ?? wiki.foundedYear,
          yearsOperating: value.yearsOperating ?? wiki.yearsOperating,
          yearsSource: value.yearsSource ?? wiki.yearsSource,
          dataSource: 'finnhub+wikipedia',
        }
      } catch {
        // Keep Finnhub data even if enrichment fails.
      }
    } catch {
      value = null
    }
  } else {
    value = null
  }

  if (!value) {
    try {
      value = await fetchCompanyProfileFromYahoo(symbol)
    } catch {
      try {
        value = await fetchCompanyProfileFromWikipedia(symbol, companyNameHint)
      } catch {
        value = await fetchCompanyProfileFromWikidata(symbol, companyNameHint)
      }
    }
  }

  const finalValue = applyProfileOverride(symbol, value)
  profileCache.set(symbol, { value: finalValue, savedAt: Date.now() })
  return finalValue
}

async function fetchSymbolData(symbol) {
  const cached = symbolCache.get(symbol)
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
    return cached.value
  }

  const stooqAvailable = Date.now() >= stooqDisabledUntil
  let value

  async function fmpThenYahoo() {
    if (FMP_API_KEY) {
      try {
        return await fetchSymbolDataFromFmp(symbol)
      } catch {
        // FMP can fail; try Yahoo next.
      }
    }
    try {
      return await fetchSymbolDataFromYahoo(symbol)
    } catch (error) {
      const msg = (error?.message ?? '').toLowerCase()
      if (
        FMP_API_KEY &&
        (msg.includes('429') && msg.includes('yahoo'))
      ) {
        try {
          return await fetchSymbolDataFromFmp(symbol)
        } catch {
          // Fall through: surface the Yahoo error below.
        }
      }
      throw error
    }
  }

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

      value = await fmpThenYahoo()
    }
  } else {
    value = await fmpThenYahoo()
  }

  symbolCache.set(symbol, { value, savedAt: Date.now() })
  return value
}

async function settleSymbolsWithConcurrency(symbols, concurrency = SYMBOL_CONCURRENCY) {
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

  const workerCount = Math.min(concurrency, symbols.length)
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()))
  return results
}

function getMarketSnapshotIfFresh() {
  if (
    marketSnapshotCache.data?.length &&
    Date.now() - marketSnapshotCache.savedAt < MARKET_SNAPSHOT_CACHE_TTL_MS
  ) {
    return marketSnapshotCache
  }
  return null
}

async function loadMarketSnapshotFromDisk() {
  try {
    const raw = await fs.readFile(SNAPSHOT_CACHE_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (
      parsed?.data?.length &&
      parsed.savedAt &&
      Date.now() - parsed.savedAt < MARKET_SNAPSHOT_CACHE_TTL_MS
    ) {
      marketSnapshotCache = {
        data: parsed.data,
        savedAt: parsed.savedAt,
        failed: parsed.failed ?? [],
      }
      console.log(
        `Loaded market snapshot from disk (${parsed.data.length} symbols, age ${Math.round((Date.now() - parsed.savedAt) / 1000)}s)`
      )
    }
  } catch {
    // No snapshot file yet.
  }
}

async function saveMarketSnapshotToDisk(snapshot) {
  try {
    await fs.mkdir(path.dirname(SNAPSHOT_CACHE_FILE), { recursive: true })
    await fs.writeFile(SNAPSHOT_CACHE_FILE, JSON.stringify(snapshot))
  } catch (error) {
    console.warn('Could not persist market snapshot:', error?.message ?? error)
  }
}

async function buildMarketSnapshotBatches(symbols, onBatchComplete) {
  const batches = []
  for (let index = 0; index < symbols.length; index += SNAPSHOT_BATCH_SIZE) {
    batches.push(symbols.slice(index, index + SNAPSHOT_BATCH_SIZE))
  }

  const allData = []
  const allFailed = []
  let completedBatches = 0
  let nextBatchIndex = 0

  async function runBatchWorker() {
    while (nextBatchIndex < batches.length) {
      const batch = batches[nextBatchIndex]
      nextBatchIndex += 1

      const results = await settleSymbolsWithConcurrency(batch, SNAPSHOT_SYMBOL_CONCURRENCY)
      const data = results.filter((result) => result.status === 'fulfilled').map((result) => result.value)
      const failed = results
        .filter((result) => result.status === 'rejected')
        .map((result) => result.reason?.message)

      allData.push(...data)
      allFailed.push(...failed)
      completedBatches += 1

      if (onBatchComplete) {
        await onBatchComplete({
          completed: completedBatches,
          total: batches.length,
          batchData: data,
          symbolsLoaded: allData.length,
          symbolsTotal: symbols.length,
        })
      }
    }
  }

  const workerCount = Math.min(SNAPSHOT_BATCH_CONCURRENCY, batches.length)
  await Promise.all(Array.from({ length: workerCount }, () => runBatchWorker()))

  return { data: allData, failed: allFailed }
}

function notifyMarketSnapshotProgress(progress) {
  for (const listener of marketSnapshotProgressListeners) {
    try {
      listener(progress)
    } catch (error) {
      console.warn('Market snapshot progress listener failed:', error?.message ?? error)
    }
  }
}

async function getOrBuildMarketSnapshot({ force = false, onBatchComplete } = {}) {
  const cached = !force && getMarketSnapshotIfFresh()
  if (cached) {
    return cached
  }

  if (onBatchComplete) {
    marketSnapshotProgressListeners.push(onBatchComplete)
  }

  if (marketSnapshotBuildPromise) {
    try {
      return await marketSnapshotBuildPromise
    } finally {
      if (onBatchComplete) {
        marketSnapshotProgressListeners = marketSnapshotProgressListeners.filter(
          (listener) => listener !== onBatchComplete
        )
      }
    }
  }

  marketSnapshotBuildPromise = (async () => {
    const universe = await fetchMarketUniverse({ force })
    const symbols = universe.map((item) => item.symbol)
    const { data, failed } = await buildMarketSnapshotBatches(symbols, notifyMarketSnapshotProgress)
    const snapshot = { data, savedAt: Date.now(), failed }
    marketSnapshotCache = snapshot
    await saveMarketSnapshotToDisk(snapshot)
    return snapshot
  })()

  try {
    return await marketSnapshotBuildPromise
  } finally {
    marketSnapshotBuildPromise = null
    marketSnapshotProgressListeners = []
  }
}

function scheduleMarketSnapshotWarmup() {
  if (getMarketSnapshotIfFresh() || marketSnapshotBuildPromise) {
    return
  }

  setTimeout(() => {
    if (getMarketSnapshotIfFresh() || marketSnapshotBuildPromise) {
      return
    }

    console.log('Pre-warming market snapshot in background…')
    void getOrBuildMarketSnapshot().then((snapshot) => {
      console.log(`Market snapshot ready (${snapshot.data.length} symbols).`)
    }).catch((error) => {
      console.warn('Market snapshot pre-warm failed:', error?.message ?? error)
    })
  }, 3000)
}

async function settleProfilesWithConcurrency(symbols, companyNameBySymbol) {
  const results = Array(symbols.length)
  let cursor = 0

  async function runWorker() {
    while (cursor < symbols.length) {
      const currentIndex = cursor
      cursor += 1
      const symbol = symbols[currentIndex]

      try {
        const companyName = companyNameBySymbol.get(symbol) ?? symbol
        const value = await fetchCompanyProfile(symbol, companyName)
        results[currentIndex] = { status: 'fulfilled', value }
      } catch (reason) {
        results[currentIndex] = {
          status: 'rejected',
          reason: new Error(reason?.message ?? `Could not load profile for ${symbol}`),
        }
      }
    }
  }

  const workerCount = Math.min(SYMBOL_CONCURRENCY, symbols.length)
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()))
  return results
}

const NON_COMMON_STOCK_NAME_RE =
  /\b(warrant|warrants|unit|units|right|rights|debenture|debentures)\b/i

function isNonCommonStock(symbol, name) {
  if (NON_COMMON_STOCK_NAME_RE.test(name)) return true
  if (/[+$^]/.test(symbol)) return true
  if (symbol.length > 2 && /W$/.test(symbol)) return true
  return false
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

async function fetchMarketUniverse({ force = false } = {}) {
  if (
    !force &&
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

    if (isNonCommonStock(symbol, name)) {
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

    if (isNonCommonStock(symbol, name)) {
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

app.get('/', (_req, res) => {
  res.json({
    service: 'stock-info-api',
    ok: true,
    message:
      'API is running. Use /api/health, /api/universe, /api/stocks, /api/company-profiles, /api/fmp/fundamentals, /api/technical-analysis',
  })
})

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

app.get('/api/universe', async (req, res) => {
  try {
    const force = req.query.force === '1' || req.query.force === 'true'
    const data = await fetchMarketUniverse({ force })
    res.json({
      total: data.length,
      cached: !force,
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

app.get('/api/market-snapshot/latest', (req, res) => {
  const cached = getMarketSnapshotIfFresh()
  if (cached) {
    res.json({
      cache: 'hit',
      savedAt: cached.savedAt,
      ageMs: Date.now() - cached.savedAt,
      total: cached.data.length,
      failed: cached.failed?.length ?? 0,
      data: cached.data,
    })
    return
  }

  res.json({
    cache: 'miss',
    building: Boolean(marketSnapshotBuildPromise),
  })
})

app.get('/api/market-snapshot', async (req, res) => {
  try {
    const force = req.query.force === '1' || req.query.force === 'true'
    const cached = !force && getMarketSnapshotIfFresh()

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    let closed = false
    req.on('close', () => { closed = true })

    if (cached) {
      if (!closed) {
        res.write(`data: ${JSON.stringify({
          type: 'progress',
          completed: 1,
          total: 1,
          batchData: cached.data,
          symbolsLoaded: cached.data.length,
          symbolsTotal: cached.data.length,
          cache: 'hit',
        })}\n\n`)
        res.write(`data: ${JSON.stringify({
          type: 'done',
          total: cached.data.length,
          failed: cached.failed?.length ?? 0,
          cache: 'hit',
        })}\n\n`)
        res.end()
      }
      return
    }

    const universe = await fetchMarketUniverse({ force })
    const symbols = universe.map((item) => item.symbol)
    const totalBatches = Math.ceil(symbols.length / SNAPSHOT_BATCH_SIZE)

    if (!closed) {
      res.write(`data: ${JSON.stringify({
        type: 'started',
        total: totalBatches,
        symbolsTotal: symbols.length,
      })}\n\n`)
    }

    let startedSent = true
    let streamedAny = false

    const snapshot = await getOrBuildMarketSnapshot({
      force,
      onBatchComplete: (progress) => {
        if (closed) {
          return
        }

        if (!startedSent) {
          startedSent = true
          res.write(`data: ${JSON.stringify({
            type: 'started',
            total: progress.total,
            symbolsTotal: progress.symbolsTotal,
          })}\n\n`)
        }

        if (progress.batchData?.length) {
          streamedAny = true
          res.write(`data: ${JSON.stringify({
            type: 'progress',
            completed: progress.completed,
            total: progress.total,
            batchData: progress.batchData,
            symbolsLoaded: progress.symbolsLoaded,
            symbolsTotal: progress.symbolsTotal,
            cache: 'miss',
          })}\n\n`)
        }
      },
    })

    if (!closed && !streamedAny && snapshot.data?.length) {
      res.write(`data: ${JSON.stringify({
        type: 'progress',
        completed: 1,
        total: 1,
        batchData: snapshot.data,
        symbolsLoaded: snapshot.data.length,
        symbolsTotal: snapshot.data.length,
        cache: 'hit',
      })}\n\n`)
    }

    if (!closed) {
      res.write(`data: ${JSON.stringify({
        type: 'done',
        total: snapshot.data.length,
        failed: snapshot.failed?.length ?? 0,
        cache: 'miss',
      })}\n\n`)
      res.end()
    }
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({
        error: error?.message ?? 'Could not generate market snapshot.',
      })
    }
  }
})

app.get('/api/fmp/fundamentals', async (req, res) => {
  if (!FMP_API_KEY) {
    res.status(503).json({
      error:
        'Financial Modeling Prep is not configured. Set FMP_API_KEY in the server environment.',
    })
    return
  }

  const symbols = parseSymbols(req.query.symbol ?? '')
  const symbol = symbols[0]

  if (!symbol) {
    res.status(400).json({
      error: 'Provide a valid symbol query parameter, e.g. ?symbol=AAPL',
    })
    return
  }

  const cached = fmpFundamentalsCache.get(symbol)
  if (cached && Date.now() - cached.savedAt < FMP_FUNDAMENTALS_CACHE_TTL_MS) {
    res.json({ cache: 'hit', ...cached.value })
    return
  }

  try {
    const data = await fetchFmpFundamentalsBundle(symbol)
    fmpFundamentalsCache.set(symbol, { value: data, savedAt: Date.now() })
    res.json({ cache: 'miss', ...data })
  } catch (error) {
    res.status(500).json({
      error: error?.message ?? 'Could not load FMP fundamentals.',
    })
  }
})

app.get('/api/technical-analysis', async (req, res) => {
  if (!FMP_API_KEY) {
    res.status(503).json({
      error:
        'Financial Modeling Prep is not configured. Set FMP_API_KEY in the server environment.',
    })
    return
  }

  const symbols = parseSymbols(req.query.symbol ?? '')
  const symbol = symbols[0]

  if (!symbol) {
    res.status(400).json({
      error: 'Provide a valid symbol query parameter, e.g. ?symbol=AAPL',
    })
    return
  }

  const cached = technicalAnalysisCache.get(symbol)
  if (cached && Date.now() - cached.savedAt < TECHNICAL_ANALYSIS_CACHE_TTL_MS) {
    res.json({ cache: 'hit', ...cached.value })
    return
  }

  try {
    const { candles, dataSource, fmpError } = await fetchOhlcv(symbol, {
      lookbackDays: 260,
    })
    const snapshot = computeTechnicalSnapshot(symbol, candles)

    let chartImageBase64 = null
    let chartImageError = null
    try {
      chartImageBase64 = await generateCandleChartPng(symbol, candles, {
        supports: snapshot.supports,
        resistances: snapshot.resistances,
      })
    } catch (error) {
      chartImageError = error?.message ?? 'Chart image generation failed.'
    }

    const provider = resolveActiveAiProvider()
    let analysis = null
    let analysisError = null
    let aiMeta = null

    if (provider) {
      try {
        const prompt = buildTechnicalAnalysisPrompt(snapshot, {
          withImage: Boolean(chartImageBase64),
        })
        const {
          rawText,
          model,
          provider: usedProvider,
          imageUsed,
        } = await callAiAnalysis(prompt, { imageBase64: chartImageBase64 })
        const parsed = parseAiAnalysisJson(rawText)
        if (!parsed) {
          analysisError = 'AI returned a response that could not be parsed as JSON.'
        } else {
          analysis = parsed
          aiMeta = { provider: usedProvider, model, imageUsed: Boolean(imageUsed) }
        }
      } catch (error) {
        analysisError = error?.message ?? 'AI analysis failed.'
      }
    } else {
      analysisError = hasAnyAiKey()
        ? 'No AI provider active. Check AI_PROVIDER env value.'
        : 'AI analysis disabled. Set GEMINI_API_KEY (free at https://aistudio.google.com/apikey) to enable the narrative.'
    }

    const responsePayload = {
      symbol: snapshot.symbol,
      asOf: snapshot.asOf,
      currentPrice: snapshot.currentPrice,
      indicators: snapshot.indicators,
      supports: snapshot.supports,
      resistances: snapshot.resistances,
      recentCandles: snapshot.recentCandles,
      dataSource,
      fmpFallbackReason: dataSource !== 'fmp' && fmpError ? fmpError : null,
      analysis,
      analysisError,
      ai: aiMeta,
      chartImageError,
      disclaimer:
        'Análisis técnico descriptivo e híbrido (datos OHLCV + gráfico renderizado). NO constituye consejo de inversión.',
    }

    // Only cache when the AI narrative succeeded — otherwise the next click should retry.
    // Indicators/levels alone (without analysis) are cheap to recompute, so this is a worthwhile trade-off.
    const aiSucceeded = analysis !== null
    if (aiSucceeded) {
      technicalAnalysisCache.set(symbol, { value: responsePayload, savedAt: Date.now() })
    }
    res.json({ cache: aiSucceeded ? 'miss' : 'no-cache', ...responsePayload })
  } catch (error) {
    res.status(500).json({
      error: error?.message ?? 'Could not load technical analysis.',
    })
  }
})

app.get('/api/company-profiles', async (req, res) => {
  const symbols = parseSymbols(req.query.symbols)

  if (!symbols.length) {
    res.status(400).json({
      error: 'Enter at least one valid ticker. Example: AAPL, MSFT, NVDA',
    })
    return
  }

  let companyNameBySymbol = new Map()
  try {
    const universe = await fetchMarketUniverse()
    companyNameBySymbol = new Map(universe.map((item) => [item.symbol, item.name]))
  } catch {
    companyNameBySymbol = new Map()
  }

  const results = await settleProfilesWithConcurrency(symbols, companyNameBySymbol)
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

server.listen(PORT, async () => {
  console.log(`Stock API server running on http://localhost:${PORT}`)
  await loadMarketSnapshotFromDisk()
  scheduleMarketSnapshotWarmup()
})

server.on('close', () => {
  console.log('Stock API server closed.')
})
