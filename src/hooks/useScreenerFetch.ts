import { useCallback, useRef, useState } from 'react'
import { PAGE_SIZE } from '../constants/app'
import { apiEndpoint } from '../services/servicesAPI.ts'
import { mapScreenerRow, type ScreenerApiRow } from '../types/screener'
import type { CountryLabel, EnrichedStock, SortDirection, SortMetric, TrendLabel } from '../types/stock'

interface UseScreenerFetchParams {
  useDbScreener: boolean
  sortMetric: SortMetric
  sortDirection: SortDirection
  universeSearch: string
  trendFilter: TrendLabel | 'all'
  countryFilter: CountryLabel | 'all'
  setError: (error: string) => void
}

export function useScreenerFetch({
  useDbScreener,
  sortMetric,
  sortDirection,
  universeSearch,
  trendFilter,
  countryFilter,
  setError,
}: UseScreenerFetchParams) {
  const [screenerRows, setScreenerRows] = useState<EnrichedStock[]>([])
  const [screenerTotal, setScreenerTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const requestIdRef = useRef(0)

  const fetchScreenerPage = useCallback(
    async ({ page = 1 }: { page?: number } = {}) => {
      if (!useDbScreener) {
        return
      }

      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId

      setLoading(true)
      setError('')

      try {
        const endpoint = apiEndpoint('/api/screener')
        endpoint.searchParams.set('offset', String((page - 1) * PAGE_SIZE))
        endpoint.searchParams.set('limit', String(PAGE_SIZE))
        endpoint.searchParams.set('sort', sortMetric)
        endpoint.searchParams.set('dir', sortDirection)
        if (universeSearch.trim()) {
          endpoint.searchParams.set('search', universeSearch.trim())
        }
        if (trendFilter !== 'all') {
          endpoint.searchParams.set('trend', trendFilter)
        }
        if (countryFilter !== 'all') {
          endpoint.searchParams.set('country', countryFilter)
        }

        const response = await fetch(endpoint)
        const payload = await response.json()

        if (requestIdRef.current !== requestId) {
          return
        }

        if (!response.ok) {
          setError(payload.error ?? 'Could not load screener data.')
          return
        }

        const mapped = ((payload.data ?? []) as ScreenerApiRow[]).map(mapScreenerRow)
        setScreenerTotal(Number(payload.total) || 0)
        setScreenerRows(mapped)
      } catch {
        if (requestIdRef.current !== requestId) {
          return
        }
        setError('Could not load screener data from database.')
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false)
        }
      }
    },
    [countryFilter, setError, sortDirection, sortMetric, trendFilter, universeSearch, useDbScreener]
  )

  return { screenerRows, screenerTotal, loading, fetchScreenerPage }
}
