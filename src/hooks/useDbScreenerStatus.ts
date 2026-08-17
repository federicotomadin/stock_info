import { useEffect, useState } from 'react'
import { apiUrl } from '../services/servicesAPI.ts'
import type { ScreenerSyncStatus } from '../types/screener'
import type { UniverseProgress } from '../types/stock'

interface UseDbScreenerStatusParams {
  onProgress: (updater: (progress: UniverseProgress) => UniverseProgress) => void
}

/** Polls PostgreSQL screener sync status. Independent from the screener data fetch to avoid a
 * circular dependency (fetchScreenerPage itself depends on `dbScreenerEnabled`). */
export function useDbScreenerStatus({ onProgress }: UseDbScreenerStatusParams) {
  const [dbScreenerEnabled, setDbScreenerEnabled] = useState<boolean | null>(null)
  const [dbConnectionError, setDbConnectionError] = useState('')
  const [screenerSyncStatus, setScreenerSyncStatus] = useState<ScreenerSyncStatus | null>(null)

  useEffect(() => {
    let cancelled = false

    async function pollScreenerStatus() {
      try {
        const response = await fetch(apiUrl('/api/screener/status'))
        const body = (await response.json()) as ScreenerSyncStatus
        if (cancelled) {
          return
        }

        setDbScreenerEnabled(Boolean(body.enabled))
        if (!body.enabled) {
          setScreenerSyncStatus(null)
          setDbConnectionError(body.error?.trim() ?? '')
          return
        }

        setDbConnectionError('')
        setScreenerSyncStatus(body)

        if (body.progress) {
          onProgress(() => ({
            completed: body.progress!.symbolsLoaded,
            total: body.progress!.symbolsTotal,
            symbolsLoaded: body.progress!.symbolsLoaded,
            symbolsTotal: body.progress!.symbolsTotal,
          }))
        }
      } catch {
        if (!cancelled) {
          setDbScreenerEnabled(false)
          setScreenerSyncStatus(null)
          setDbConnectionError('Could not reach the API to check PostgreSQL status.')
        }
      }
    }

    void pollScreenerStatus()

    const intervalMs = dbScreenerEnabled === true ? 2500 : 8000
    const intervalId = window.setInterval(() => {
      void pollScreenerStatus()
    }, intervalMs)

    return () => {
      cancelled = true
      if (intervalId != null) {
        window.clearInterval(intervalId)
      }
    }
  }, [dbScreenerEnabled, onProgress])

  return { dbScreenerEnabled, dbConnectionError, screenerSyncStatus }
}
