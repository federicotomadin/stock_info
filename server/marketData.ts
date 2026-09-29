// @ts-nocheck
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  CACHE_TTL_MS,
  FMP_API_KEY,
  MARKET_SNAPSHOT_CACHE_TTL_MS,
  SNAPSHOT_BATCH_CONCURRENCY,
  SNAPSHOT_BATCH_SIZE,
  SNAPSHOT_CACHE_FILE,
  SNAPSHOT_SYMBOL_CONCURRENCY,
  SYMBOL_CONCURRENCY,
  UNIVERSE_TTL_MS,
} from './config.js'
import { toStooqTicker } from './lib/utils.js'
import { fetchWithTimeout, withRetries } from './lib/http.js'
import { buildStockFromCsv } from './lib/stock.js'
import { fetchSymbolDataFromFmp } from './providers/fmp.js'
import { fetchSymbolDataFromYahoo } from './providers/yahoo.js'
import { fetchMarketCaps } from './providers/nasdaqScreener.js'

const symbolCache = new Map()
let stooqDisabledUntil = 0

export async function fetchSymbolData(symbol) {
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

export async function settleSymbolsWithConcurrency(symbols, concurrency = SYMBOL_CONCURRENCY) {
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

let marketUniverseCache = { data: null, savedAt: 0 }
let marketSnapshotCache = { data: null, savedAt: 0, failed: [] }
export let marketSnapshotBuildPromise = null
let marketSnapshotProgressListeners = []

export function getMarketSnapshotIfFresh() {
  if (
    marketSnapshotCache.data?.length &&
    Date.now() - marketSnapshotCache.savedAt < MARKET_SNAPSHOT_CACHE_TTL_MS
  ) {
    return marketSnapshotCache
  }
  return null
}

export async function loadMarketSnapshotFromDisk() {
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

export async function getOrBuildMarketSnapshot({ force = false, onBatchComplete } = {}) {
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

export function scheduleMarketSnapshotWarmup() {
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

export async function fetchMarketUniverse({ force = false } = {}) {
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

  const marketCaps = await fetchMarketCaps()
  const merged = [...nasdaqSymbols, ...otherSymbols]
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
    .filter((item, index, arr) => index === 0 || item.symbol !== arr[index - 1].symbol)
    .map((item) => ({ ...item, marketCap: marketCaps.get(item.symbol) ?? null }))

  marketUniverseCache = {
    data: merged,
    savedAt: Date.now(),
  }

  return merged
}
