import { useEffect } from 'react'
import { useMarketUniverse } from './useMarketUniverse'
import { useDbScreenerStatus } from './useDbScreenerStatus'
import { useScreenerFetch } from './useScreenerFetch'
import { useScreenerDerivedData } from './useScreenerDerivedData'
import { useFullMarketFetch } from './useFullMarketFetch'
import { useManualTickerFetch } from './useManualTickerFetch'
import type {
  AppMode,
  CountryLabel,
  SortDirection,
  SortMetric,
  StockQuote,
  TrendLabel,
  UniverseProgress,
} from '../types/stock'

interface UseScreenerDataParams {
  symbolsInput: string
  stocks: StockQuote[]
  setStocks: (stocks: StockQuote[] | ((current: StockQuote[]) => StockQuote[])) => void
  universeSearch: string
  currentPage: number
  setCurrentPage: (page: number) => void
  setError: (error: string) => void
  setWarning: (warning: string) => void
  setUniverseProgress: (updater: UniverseProgress | ((current: UniverseProgress) => UniverseProgress)) => void
  mode: AppMode
  sortMetric: SortMetric
  sortDirection: SortDirection
  trendFilter: TrendLabel | 'all'
  countryFilter: CountryLabel | 'all'
}

/** Facade over every screener data-fetching hook (market universe, DB sync status, DB screener
 * page fetch, client-side derived lists, full-market SSE/batch fetch, and manual ticker fetch),
 * plus the small effects that wire them together. Keeps App.tsx focused on layout composition. */
export function useScreenerData({
  symbolsInput,
  stocks,
  setStocks,
  universeSearch,
  currentPage,
  setCurrentPage,
  setError,
  setWarning,
  setUniverseProgress,
  mode,
  sortMetric,
  sortDirection,
  trendFilter,
  countryFilter,
}: UseScreenerDataParams) {
  const { marketUniverse, universeLoading, universeError, loadUniverse } = useMarketUniverse()
  const { dbScreenerEnabled, dbConnectionError, screenerSyncStatus } = useDbScreenerStatus({
    onProgress: setUniverseProgress,
  })
  const useDbScreener = mode === 'universe' && dbScreenerEnabled === true

  const {
    screenerRows,
    screenerTotal,
    loading: screenerFetchLoading,
    fetchScreenerPage,
  } = useScreenerFetch({
    useDbScreener,
    sortMetric,
    sortDirection,
    universeSearch,
    trendFilter,
    countryFilter,
    setError,
  })

  const { filteredUniverse, sortedStocks, countryFilteredStocks, displayStocks, totalPages } =
    useScreenerDerivedData({
      marketUniverse,
      universeSearch,
      stocks,
      sortMetric,
      sortDirection,
      trendFilter,
      countryFilter,
      mode,
      symbolsInput,
      useDbScreener,
      screenerRows,
      screenerTotal,
      currentPage,
    })

  const { loading: fullMarketLoading, loadUniverseStocks } = useFullMarketFetch({
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
  })

  const { manualStocksLoading, fetchManualStocks } = useManualTickerFetch({
    symbolsInput,
    mode,
    setStocks,
    setError,
    setWarning,
  })

  // Debounce filter/sort/search changes before hitting the DB screener or rebuilding the full snapshot.
  useEffect(() => {
    if (mode !== 'universe' || dbScreenerEnabled === null) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      if (dbScreenerEnabled) {
        void fetchScreenerPage({ page: currentPage })
      } else if (!dbConnectionError) {
        void loadUniverseStocks()
      }
    }, 350)

    return () => window.clearTimeout(timeoutId)
  }, [
    countryFilter,
    currentPage,
    dbConnectionError,
    dbScreenerEnabled,
    fetchScreenerPage,
    loadUniverseStocks,
    mode,
    sortDirection,
    sortMetric,
    trendFilter,
    universeSearch,
  ])

  // Once the background sync finishes populating PostgreSQL, load the first page automatically.
  useEffect(() => {
    if (
      screenerSyncStatus &&
      !screenerSyncStatus.syncing &&
      Number(screenerSyncStatus.totalQuotes) > 0 &&
      screenerRows.length === 0 &&
      mode === 'universe' &&
      dbScreenerEnabled
    ) {
      void fetchScreenerPage({ page: currentPage })
    }
  }, [currentPage, dbScreenerEnabled, fetchScreenerPage, mode, screenerRows.length, screenerSyncStatus])

  // Any filter/sort/search change invalidates the current page's offset — jump back to page 1.
  useEffect(() => {
    setCurrentPage(1)
  }, [countryFilter, sortDirection, sortMetric, trendFilter, universeSearch, setCurrentPage])

  useEffect(() => {
    if (mode !== 'universe') {
      setCurrentPage(1)
    }
  }, [universeSearch, mode, trendFilter, countryFilter, setCurrentPage])

  return {
    marketUniverse,
    universeLoading,
    universeError,
    loadUniverse,
    useDbScreener,
    dbScreenerEnabled,
    dbConnectionError,
    screenerRows,
    screenerTotal,
    screenerFetchLoading,
    fetchScreenerPage,
    filteredUniverse,
    sortedStocks,
    countryFilteredStocks,
    displayStocks,
    totalPages,
    fullMarketLoading,
    loadUniverseStocks,
    manualStocksLoading,
    fetchManualStocks,
  }
}
