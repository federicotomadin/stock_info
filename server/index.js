import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import http from 'node:http'

const app = express()
const PORT = Number(process.env.PORT || 9001)
const MAX_SYMBOLS = 120
const SYMBOL_CONCURRENCY = 4
const FETCH_RETRIES = 2
const CACHE_TTL_MS = 5 * 60 * 1000
const PROFILE_CACHE_TTL_MS = 12 * 60 * 60 * 1000
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY?.trim()
const FMP_API_KEY = process.env.FMP_API_KEY?.trim()
const FMP_BASE = 'https://financialmodelingprep.com/api/v3'
const FMP_FUNDAMENTALS_CACHE_TTL_MS = 60 * 60 * 1000
const fmpFundamentalsCache = new Map()
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

async function fetchFmpJson(relPath) {
  if (!FMP_API_KEY) {
    throw new Error('FMP_API_KEY is not configured')
  }

  const url = `${FMP_BASE}${relPath}${relPath.includes('?') ? '&' : '?'}apikey=${encodeURIComponent(FMP_API_KEY)}`
  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'stock-info-local-app/1.0',
      },
    },
    20000
  )

  const text = await response.text()
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`FMP returned non-JSON (HTTP ${response.status})`)
  }

  if (!response.ok) {
    const message =
      payload?.['Error Message'] ?? payload?.message ?? `FMP HTTP ${response.status}`
    throw new Error(message)
  }

  if (
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    payload['Error Message']
  ) {
    throw new Error(payload['Error Message'])
  }

  return payload
}

async function fetchFmpFundamentalsBundle(symbol) {
  const upper = symbol.toUpperCase()
  const paths = {
    profile: `/profile/${encodeURIComponent(upper)}`,
    keyMetricsTtm: `/key-metrics-ttm/${encodeURIComponent(upper)}`,
    ratiosTtm: `/ratios-ttm/${encodeURIComponent(upper)}`,
    incomeStatement: `/income-statement/${encodeURIComponent(upper)}?limit=5`,
    balanceSheet: `/balance-sheet-statement/${encodeURIComponent(upper)}?limit=5`,
    cashFlow: `/cash-flow-statement/${encodeURIComponent(upper)}?limit=5`,
    dcf: `/discounted-cash-flow/${encodeURIComponent(upper)}`,
  }

  const settled = await Promise.all(
    Object.entries(paths).map(async ([key, path]) => {
      try {
        const data = await fetchFmpJson(path)
        return [key, { ok: true, data }]
      } catch (error) {
        return [key, { ok: false, error: error?.message ?? String(error) }]
      }
    })
  )

  const map = Object.fromEntries(settled)

  return {
    symbol: upper,
    dataSource: 'financialmodelingprep.com',
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

/**
 * Daily closes in chronological order (oldest → newest). Null/NaN entries are allowed between valid closes.
 */
function buildStockFromSortedDailyCloses(symbol, closes, updatedAtRaw) {
  if (!Array.isArray(closes) || !closes.length) {
    throw new Error(`Not enough historical data for ${symbol}.`)
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

  let updatedAt = ''
  if (updatedAtRaw != null) {
    updatedAt = String(updatedAtRaw).slice(0, 10)
  }

  return {
    symbol,
    price: latestClose,
    updatedAt,
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
  const path = `/historical-price-full/${encodeURIComponent(upper)}?from=${from}`

  const payload = await withRetries(async () => fetchFmpJson(path), 1)
  const rows = payload?.historical

  if (!Array.isArray(rows) || rows.length < 3) {
    throw new Error(`FMP returned insufficient rows for ${symbol}`)
  }

  const sorted = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const closes = sorted.map((row) => Number(row.close ?? row.adjClose))
  const latestRow = sorted[sorted.length - 1]

  return buildStockFromSortedDailyCloses(symbol, closes, latestRow?.date)
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

async function fetchCompanyProfileFromYahoo(symbol) {
  const yahooTicker = toYahooTicker(symbol)
  const hosts = [
    'https://query1.finance.yahoo.com',
    'https://query2.finance.yahoo.com',
  ]

  let lastError = null

  for (const host of hosts) {
    try {
      const value = await withRetries(async () => {
        const endpoint =
          `${host}/v10/finance/quoteSummary/${encodeURIComponent(yahooTicker)}` +
          '?modules=assetProfile,price'
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
      })

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
        // Yahoo is often rate-limited (HTTP 429); FMP is the preferred fallback when configured.
      }
    }
    return fetchSymbolDataFromYahoo(symbol)
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

app.get('/', (_req, res) => {
  res.json({
    service: 'stock-info-api',
    ok: true,
    message:
      'API is running. Use /api/health, /api/universe, /api/stocks, /api/company-profiles, /api/fmp/fundamentals',
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

server.listen(PORT, () => {
  console.log(`Stock API server running on http://localhost:${PORT}`)
})

server.on('close', () => {
  console.log('Stock API server closed.')
})
