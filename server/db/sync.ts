import { detectCountry } from './country.js'
import {
  finishSyncRun,
  failSyncRun,
  getLatestSyncFinishedAt,
  startSyncRun,
  upsertQuote,
  upsertTicker,
} from './queries.js'
import { analyzeTrend } from './trend.js'

export interface UniverseItem {
  symbol: string
  name: string
  exchange: string
}

export interface StockQuote {
  symbol: string
  price: number
  updatedAt: string
  dayChange: number | null
  monthChange: number | null
  yearChange: number | null
  rsi14?: number | null
  sma20?: number | null
  sma50?: number | null
  sma200?: number | null
}

export interface SyncProgress {
  symbolsLoaded: number
  symbolsTotal: number
  updated: number
  unchanged: number
  failed: number
}

export interface SyncDeps {
  fetchMarketUniverse: (options?: { force?: boolean }) => Promise<UniverseItem[]>
  fetchSymbolData: (symbol: string) => Promise<StockQuote>
  batchSize?: number
  concurrency?: number
  onProgress?: (progress: SyncProgress) => void
}

const DEFAULT_SYNC_TTL_MS = 20 * 60 * 1000

let syncPromise: Promise<void> | null = null
let syncProgress: SyncProgress = {
  symbolsLoaded: 0,
  symbolsTotal: 0,
  updated: 0,
  unchanged: 0,
  failed: 0,
}

export function isSyncRunning(): boolean {
  return syncPromise != null
}

export function getSyncProgress(): SyncProgress {
  return { ...syncProgress }
}

export async function syncMarketData(
  deps: SyncDeps,
  { force = false }: { force?: boolean } = {}
): Promise<void> {
  if (syncPromise) {
    return syncPromise
  }

  if (!force) {
    const lastFinished = await getLatestSyncFinishedAt()
    if (lastFinished && Date.now() - lastFinished.getTime() < DEFAULT_SYNC_TTL_MS) {
      return
    }
  }

  syncPromise = runSync(deps, force).finally(() => {
    syncPromise = null
  })

  return syncPromise
}

async function runSync(deps: SyncDeps, force: boolean): Promise<void> {
  const batchSize = deps.batchSize ?? 120
  const concurrency = deps.concurrency ?? 8

  const universe = await deps.fetchMarketUniverse({ force })
  const symbols = universe.map((item) => item.symbol)
  const tickerBySymbol = new Map(universe.map((item) => [item.symbol, item]))

  syncProgress = {
    symbolsLoaded: 0,
    symbolsTotal: symbols.length,
    updated: 0,
    unchanged: 0,
    failed: 0,
  }
  deps.onProgress?.(syncProgress)

  const runId = await startSyncRun(symbols.length)

  try {
    for (const item of universe) {
      await upsertTicker({
        symbol: item.symbol,
        name: item.name,
        exchange: item.exchange,
        country: detectCountry(item),
      })
    }

    const batches: string[][] = []
    for (let index = 0; index < symbols.length; index += batchSize) {
      batches.push(symbols.slice(index, index + batchSize))
    }

    let nextBatch = 0

    async function runWorker() {
      while (nextBatch < batches.length) {
        const batch = batches[nextBatch]
        nextBatch += 1

        let cursor = 0
        async function runSymbolWorker() {
          while (cursor < batch.length) {
            const currentIndex = cursor
            cursor += 1
            const symbol = batch[currentIndex]
            const ticker = tickerBySymbol.get(symbol)
            if (!ticker) {
              syncProgress.failed += 1
              syncProgress.symbolsLoaded += 1
              continue
            }

            try {
              const quote = await deps.fetchSymbolData(symbol)
              const trend = analyzeTrend(quote)
              const changed = await upsertQuote({
                symbol: quote.symbol,
                price: quote.price,
                updatedAt: quote.updatedAt,
                dayChange: quote.dayChange,
                monthChange: quote.monthChange,
                yearChange: quote.yearChange,
                rsi14: quote.rsi14,
                sma20: quote.sma20,
                sma50: quote.sma50,
                sma200: quote.sma200,
                trendScore: trend.score,
                trendLabel: trend.label,
              })

              if (changed) {
                syncProgress.updated += 1
              } else {
                syncProgress.unchanged += 1
              }
            } catch {
              syncProgress.failed += 1
            } finally {
              syncProgress.symbolsLoaded += 1
            }
          }
        }

        const symbolWorkers = Math.min(concurrency, batch.length || 1)
        await Promise.all(Array.from({ length: symbolWorkers }, () => runSymbolWorker()))

        deps.onProgress?.({ ...syncProgress })
      }
    }

    const workerCount = Math.min(concurrency, batches.length || 1)
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()))

    await finishSyncRun(runId, {
      updated: syncProgress.updated,
      unchanged: syncProgress.unchanged,
      failed: syncProgress.failed,
    })
  } catch (error) {
    await failSyncRun(runId)
    throw error
  }
}

export function scheduleMarketSync(deps: SyncDeps): void {
  setTimeout(() => {
    void syncMarketData(deps).catch((error) => {
      console.warn('Background market sync failed:', error?.message ?? error)
    })
  }, 4000)
}
