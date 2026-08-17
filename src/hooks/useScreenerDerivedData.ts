import { useMemo } from 'react'
import { PAGE_SIZE } from '../constants/app'
import { detectCountry } from '../lib/country'
import { analyzeTrend } from '../lib/trend'
import { parseSymbols } from '../utils'
import type {
  AppMode,
  CountryLabel,
  EnrichedStock,
  SortDirection,
  SortMetric,
  StockQuote,
  TrendLabel,
  UniverseItem,
} from '../types/stock'

interface UseScreenerDerivedDataParams {
  marketUniverse: UniverseItem[]
  universeSearch: string
  stocks: StockQuote[]
  sortMetric: SortMetric
  sortDirection: SortDirection
  trendFilter: TrendLabel | 'all'
  countryFilter: CountryLabel | 'all'
  mode: AppMode
  symbolsInput: string
  useDbScreener: boolean
  screenerRows: EnrichedStock[]
  screenerTotal: number
  currentPage: number
}

export function useScreenerDerivedData({
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
}: UseScreenerDerivedDataParams) {
  const filteredUniverse = useMemo(() => {
    const query = universeSearch.trim().toUpperCase()
    if (!query) {
      return marketUniverse
    }

    return marketUniverse.filter(
      (item) =>
        item.symbol.includes(query) ||
        item.name.toUpperCase().includes(query) ||
        item.exchange.toUpperCase().includes(query)
    )
  }, [marketUniverse, universeSearch])

  const metadataBySymbol = useMemo(() => {
    return new Map(marketUniverse.map((item) => [item.symbol, item]))
  }, [marketUniverse])

  const sortedStocks = useMemo(() => {
    const sorted = stocks.map((stock) => {
      const enriched = {
        ...stock,
        ...(metadataBySymbol.get(stock.symbol) ?? {}),
      }

      return {
        ...enriched,
        trend: analyzeTrend(enriched),
        country: detectCountry(enriched),
      }
    })

    sorted.sort((a, b) => {
      const metricByKey: Record<SortMetric, 'trendScore' | 'dayChange' | 'monthChange' | 'yearChange'> = {
        trend: 'trendScore',
        day: 'dayChange',
        month: 'monthChange',
        year: 'yearChange',
      }

      const key = metricByKey[sortMetric]
      const valueA = key === 'trendScore' ? a.trend.score : (a[key] ?? Number.NEGATIVE_INFINITY)
      const valueB = key === 'trendScore' ? b.trend.score : (b[key] ?? Number.NEGATIVE_INFINITY)

      if (sortDirection === 'asc') {
        return valueA - valueB
      }

      return valueB - valueA
    })

    return sorted
  }, [metadataBySymbol, stocks, sortMetric, sortDirection])

  const trendFilteredStocks = useMemo(() => {
    if (trendFilter === 'all') {
      return sortedStocks
    }

    return sortedStocks.filter((stock) => stock.trend.label === trendFilter)
  }, [sortedStocks, trendFilter])

  const countryFilteredStocks = useMemo(() => {
    if (countryFilter === 'all') {
      return trendFilteredStocks
    }

    return trendFilteredStocks.filter((stock) => stock.country === countryFilter)
  }, [countryFilter, trendFilteredStocks])

  const displayStocks = useMemo(() => {
    if (mode === 'manual') {
      const requestedSymbols = new Set(parseSymbols(symbolsInput))
      if (!requestedSymbols.size) {
        return []
      }
      return countryFilteredStocks.filter((stock) =>
        requestedSymbols.has(String(stock.symbol ?? '').toUpperCase())
      )
    }

    if (useDbScreener) {
      return screenerRows
    }

    const start = (currentPage - 1) * PAGE_SIZE
    return countryFilteredStocks.slice(start, start + PAGE_SIZE)
  }, [countryFilteredStocks, currentPage, mode, screenerRows, symbolsInput, useDbScreener])

  const totalPages = useMemo(() => {
    if (mode !== 'universe') {
      return 1
    }

    if (useDbScreener) {
      return Math.max(1, Math.ceil(screenerTotal / PAGE_SIZE))
    }

    return Math.max(1, Math.ceil(countryFilteredStocks.length / PAGE_SIZE))
  }, [countryFilteredStocks.length, mode, screenerTotal, useDbScreener])

  return {
    filteredUniverse,
    sortedStocks,
    trendFilteredStocks,
    countryFilteredStocks,
    displayStocks,
    totalPages,
  }
}
