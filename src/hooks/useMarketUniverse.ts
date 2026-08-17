import { useCallback, useEffect, useRef, useState } from 'react'
import { apiUrl, hasApiOriginConfigured } from '../services/servicesAPI.ts'
import type { UniverseItem } from '../types/stock'

export function useMarketUniverse() {
  const [marketUniverse, setMarketUniverse] = useState<UniverseItem[]>([])
  const [universeLoading, setUniverseLoading] = useState(false)
  const [universeError, setUniverseError] = useState('')
  const hasLoadedUniverseRef = useRef(false)

  const loadUniverse = useCallback(async ({ force = false } = {}) => {
    setUniverseLoading(true)
    setUniverseError('')

    try {
      const url = force ? apiUrl('/api/universe?force=1') : apiUrl('/api/universe')

      const response = await fetch(url)
      let payload: { error?: string; data?: UniverseItem[] } = {}
      try {
        payload = await response.json()
      } catch {
        payload = {}
      }

      if (!response.ok) {
        setUniverseError(payload.error ?? 'Could not load the market universe.')
        return
      }

      setMarketUniverse(payload.data ?? [])
    } catch {
      setUniverseError(
        import.meta.env.PROD && !hasApiOriginConfigured()
          ? 'No API URL in this build. Add repository secret or variable VITE_API_ORIGIN (your backend https URL, no trailing slash) and run the Deploy workflow again.'
          : 'Could not download the full stock list.'
      )
    } finally {
      setUniverseLoading(false)
    }
  }, [])

  useEffect(() => {
    if (hasLoadedUniverseRef.current) {
      return
    }

    hasLoadedUniverseRef.current = true
    void loadUniverse()
  }, [loadUniverse])

  return { marketUniverse, universeLoading, universeError, loadUniverse }
}
