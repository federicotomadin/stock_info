import { useCallback } from 'react'
import type { CountryLabel, SortMetric, TrendLabel } from '../types/stock'

interface UseScreenerFilterHandlersParams {
  setSortMetric: (metric: SortMetric) => void
  setSortDirection: (updater: (current: 'asc' | 'desc') => 'asc' | 'desc') => void
  setTrendFilter: (label: TrendLabel | 'all') => void
  setCountryFilter: (label: CountryLabel | 'all') => void
  setCurrentPage: (page: number) => void
}

/** Sort/trend/country filter changes all reset pagination back to page 1 — centralized here so
 * App.tsx only wires the resulting callbacks instead of repeating the pattern inline. */
export function useScreenerFilterHandlers({
  setSortMetric,
  setSortDirection,
  setTrendFilter,
  setCountryFilter,
  setCurrentPage,
}: UseScreenerFilterHandlersParams) {
  const onSortMetricChange = useCallback(
    (metric: SortMetric) => {
      setSortMetric(metric)
      setCurrentPage(1)
    },
    [setCurrentPage, setSortMetric]
  )

  const onToggleSortDirection = useCallback(() => {
    setSortDirection((current) => (current === 'desc' ? 'asc' : 'desc'))
    setCurrentPage(1)
  }, [setCurrentPage, setSortDirection])

  const onTrendFilterChange = useCallback(
    (label: TrendLabel | 'all') => {
      setTrendFilter(label)
      setCurrentPage(1)
    },
    [setCurrentPage, setTrendFilter]
  )

  const onCountryFilterChange = useCallback(
    (label: CountryLabel | 'all') => {
      setCountryFilter(label)
      setCurrentPage(1)
    },
    [setCountryFilter, setCurrentPage]
  )

  return { onSortMetricChange, onToggleSortDirection, onTrendFilterChange, onCountryFilterChange }
}
