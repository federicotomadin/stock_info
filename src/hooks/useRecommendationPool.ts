import { useEffect, useState } from 'react'
import { apiEndpoint } from '../services/servicesAPI.ts'
import { mapScreenerRow, type ScreenerApiRow } from '../types/screener'
import type { EnrichedStock } from '../types/stock'

interface UseRecommendationPoolParams {
  useDbScreener: boolean
  screenerTotal: number
}

/** Pulls actionable setups + strong movers from the DB screener for the investor-profile picks. */
export function useRecommendationPool({ useDbScreener, screenerTotal }: UseRecommendationPoolParams) {
  const [fetchedPool, setFetchedPool] = useState<EnrichedStock[]>([])

  useEffect(() => {
    if (!useDbScreener) {
      return
    }

    const requests: Array<{ sort: 'trend' | 'month' | 'day'; trend?: string }> = [
      { sort: 'month' },
      { sort: 'day' },
      { sort: 'trend' },
      { sort: 'month', trend: 'Momentum' },
      { sort: 'day', trend: 'Early breakout' },
      { sort: 'day', trend: 'Reversal' },
      { sort: 'month', trend: 'Pullback bounce' },
    ]

    void Promise.all(
      requests.map(async ({ sort, trend }) => {
        const endpoint = apiEndpoint('/api/screener')
        endpoint.searchParams.set('limit', '120')
        endpoint.searchParams.set('sort', sort)
        endpoint.searchParams.set('dir', 'desc')
        if (trend) {
          endpoint.searchParams.set('trend', trend)
        }
        const response = await fetch(endpoint)
        const payload = await response.json()
        return ((payload.data ?? []) as ScreenerApiRow[]).map(mapScreenerRow)
      })
    )
      .then((chunks) => {
        const bySymbol = new Map<string, EnrichedStock>()
        for (const chunk of chunks) {
          for (const stock of chunk) {
            if (!bySymbol.has(stock.symbol)) {
              bySymbol.set(stock.symbol, stock)
            }
          }
        }
        setFetchedPool([...bySymbol.values()])
      })
      .catch(() => setFetchedPool([]))
  }, [screenerTotal, useDbScreener])

  return useDbScreener ? fetchedPool : []
}
