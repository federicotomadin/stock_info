import { useCallback, useEffect, useRef, useState } from 'react'
import { BATCH_CONCURRENCY, MAX_SYMBOLS } from '../constants/app'
import { readMarketSnapshotCache, writeMarketSnapshotCache } from '../lib/marketSnapshotCache'
import { apiEndpoint, apiUrl, hasApiOriginConfigured } from '../services/servicesAPI.ts'
import type { AppMode, MarketSnapshotCache, StockQuote, UniverseItem, UniverseProgress } from '../types/stock'

interface UseFullMarketFetchParams {
  mode: AppMode
  useDbScreener: boolean
  filteredUniverse: UniverseItem[]
  marketUniverse: UniverseItem[]
  currentPage: number
  fetchScreenerPage: (params: { page?: number }) => Promise<void>
  setStocks: (updater: StockQuote[] | ((current: StockQuote[]) => StockQuote[])) => void
  setError: (error: string) => void
  setWarning: (warning: string) => void
  setUniverseProgress: (updater: UniverseProgress | ((current: UniverseProgress) => UniverseProgress)) => void
}

const EMPTY_PROGRESS: UniverseProgress = {
  completed: 0,
  total: 0,
  symbolsLoaded: 0,
  symbolsTotal: 0,
}

export function useFullMarketFetch({
  mode,
  useDbScreener,
  filteredUniverse,
  marketUniverse,
  currentPage,
  fetchScreenerPage,
  setStocks,
  setError,
  setWarning,
  setUniverseProgress,
}: UseFullMarketFetchParams) {
  const [loading, setLoading] = useState(false)
  const requestIdRef = useRef(0)

  const loadUniverseStocks = useCallback(
    async ({ forceRefresh = false } = {}) => {
      if (mode !== 'universe') {
        return
      }

      if (useDbScreener) {
        if (forceRefresh) {
          try {
            await fetch(apiUrl('/api/screener/sync?force=1'), { method: 'POST' })
          } catch {
            // Sync trigger is best-effort; screener still reads cached DB rows.
          }
        }
        await fetchScreenerPage({ page: currentPage })
        return
      }

      if (!filteredUniverse.length) {
        setStocks([])
        setUniverseProgress(EMPTY_PROGRESS)
        return
      }

      const isFullUniverse = filteredUniverse.length === marketUniverse.length

      const applyCachedSnapshot = (cached: MarketSnapshotCache, sourceLabel: string) => {
        setStocks(cached.data)
        setUniverseProgress({
          completed: 1,
          total: 1,
          symbolsLoaded: cached.data.length,
          symbolsTotal: cached.data.length,
        })
        setWarning(
          `Showing cached data from ${sourceLabel} (${Math.round((Date.now() - cached.savedAt) / 1000)}s ago). Click "Refresh data" to update.`
        )
      }

      if (!forceRefresh && isFullUniverse) {
        const localCached = readMarketSnapshotCache()
        if (localCached) {
          applyCachedSnapshot(localCached, 'browser')
          return
        }

        try {
          const response = await fetch(apiUrl('/api/market-snapshot/latest'))
          const body = await response.json()
          if (response.ok && body.cache === 'hit' && body.data?.length) {
            const serverCached = { data: body.data, savedAt: body.savedAt }
            writeMarketSnapshotCache(body.data)
            applyCachedSnapshot(serverCached, 'server')
            return
          }
        } catch {
          // Fall through to SSE build.
        }
      }

      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId

      setLoading(true)
      setError('')
      setWarning('')
      setUniverseProgress(EMPTY_PROGRESS)

      try {
        if (isFullUniverse) {
          const url = forceRefresh
            ? apiUrl('/api/market-snapshot?force=1')
            : apiUrl('/api/market-snapshot')
          const eventSource = new EventSource(url)
          const aggregatedStocks: StockQuote[] = []

          await new Promise<void>((resolve, reject) => {
            eventSource.onmessage = (event) => {
              if (requestIdRef.current !== requestId) {
                eventSource.close()
                resolve()
                return
              }

              try {
                const msg = JSON.parse(event.data)

                if (msg.type === 'started') {
                  setUniverseProgress((progress) => ({
                    ...progress,
                    total: msg.total,
                    symbolsTotal: msg.symbolsTotal,
                  }))
                } else if (msg.type === 'progress') {
                  aggregatedStocks.push(...(msg.batchData ?? []))
                  setStocks([...aggregatedStocks])
                  setUniverseProgress({
                    completed: msg.completed,
                    total: msg.total,
                    symbolsLoaded: msg.symbolsLoaded ?? aggregatedStocks.length,
                    symbolsTotal: msg.symbolsTotal ?? aggregatedStocks.length,
                  })
                } else if (msg.type === 'done') {
                  eventSource.close()
                  setStocks([...aggregatedStocks])

                  if (aggregatedStocks.length) {
                    writeMarketSnapshotCache(aggregatedStocks)
                  }

                  if (!aggregatedStocks.length) {
                    setError('Could not load stock data for the selected universe.')
                  } else if (msg.failed > 0) {
                    setWarning(`Partial results loaded. Failed symbols: ${msg.failed}`)
                  } else if (msg.cache === 'hit') {
                    setWarning('')
                  }
                  resolve()
                }
              } catch {
                eventSource.close()
                reject(new Error('Malformed SSE data'))
              }
            }

            eventSource.onerror = () => {
              eventSource.close()
              reject(new Error('SSE connection failed'))
            }
          })
        } else {
          const symbols = filteredUniverse.map((item) => item.symbol)
          const symbolBatches: string[][] = []
          for (let index = 0; index < symbols.length; index += MAX_SYMBOLS) {
            symbolBatches.push(symbols.slice(index, index + MAX_SYMBOLS))
          }

          setUniverseProgress({
            completed: 0,
            total: symbolBatches.length,
            symbolsLoaded: 0,
            symbolsTotal: symbols.length,
          })
          const aggregatedStocks: StockQuote[] = []
          const failedMessages: string[] = []

          let nextBatchIndex = 0

          async function runBatchWorker() {
            while (nextBatchIndex < symbolBatches.length) {
              if (requestIdRef.current !== requestId) return

              const batch = symbolBatches[nextBatchIndex]
              nextBatchIndex += 1

              try {
                const endpoint = apiEndpoint('/api/stocks')
                endpoint.searchParams.set('symbols', batch.join(','))
                const response = await fetch(endpoint)
                const payload = await response.json()

                if (requestIdRef.current !== requestId) return

                if (!response.ok) {
                  failedMessages.push(payload.error ?? 'Could not load one stock batch.')
                } else {
                  aggregatedStocks.push(...(payload.data ?? []))
                  setStocks([...aggregatedStocks])
                  if (payload.failed?.length) failedMessages.push(...payload.failed)
                }
              } catch {
                failedMessages.push('Could not load one stock batch.')
              } finally {
                if (requestIdRef.current === requestId) {
                  setUniverseProgress((progress) => ({
                    ...progress,
                    completed: progress.completed + 1,
                    symbolsLoaded: aggregatedStocks.length,
                    symbolsTotal: symbols.length,
                  }))
                }
              }
            }
          }

          await Promise.all(
            Array.from({ length: Math.min(BATCH_CONCURRENCY, symbolBatches.length) }, () =>
              runBatchWorker()
            )
          )

          if (requestIdRef.current !== requestId) return

          setStocks(aggregatedStocks)
          if (!aggregatedStocks.length) {
            setError(failedMessages[0] ?? 'Could not load stock data for the selected universe.')
          } else if (failedMessages.length) {
            setWarning(`Partial results loaded. Failed symbols: ${failedMessages.length}`)
          }
        }
      } catch {
        if (requestIdRef.current !== requestId) return

        setStocks([])
        setError(
          import.meta.env.PROD && !hasApiOriginConfigured()
            ? 'No API URL in this build. Set VITE_API_ORIGIN (https backend URL) in GitHub and redeploy.'
            : 'Could not connect to local server. Run npm run dev to start frontend and API.'
        )
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false)
        }
      }
    },
    [
      currentPage,
      fetchScreenerPage,
      filteredUniverse,
      marketUniverse.length,
      mode,
      setError,
      setStocks,
      setUniverseProgress,
      setWarning,
      useDbScreener,
    ]
  )

  // Manual mode owns `stocks`/`error`/`warning` while active; drop stale universe requests here.
  useEffect(() => {
    if (mode === 'manual') {
      requestIdRef.current += 1
      setLoading(false)
      setStocks([])
      setUniverseProgress(EMPTY_PROGRESS)
      setError('')
      setWarning('')
    }
  }, [mode, setError, setStocks, setUniverseProgress, setWarning])

  return { loading, loadUniverseStocks }
}
