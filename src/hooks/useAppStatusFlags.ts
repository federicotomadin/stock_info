import { DB_EXPIRES_AT } from '../constants/app'
import { formatDbExpiryLabel } from '../types/screener'
import type { AppMode, UniverseProgress } from '../types/stock'

interface UseAppStatusFlagsParams {
  mode: AppMode
  useDbScreener: boolean
  manualStocksLoading: boolean
  screenerFetchLoading: boolean
  fullMarketLoading: boolean
  screenerRowsLength: number
  universeProgress: UniverseProgress
}

/** Small derived-status calculations kept out of App.tsx to keep it focused on composition. */
export function useAppStatusFlags({
  mode,
  useDbScreener,
  manualStocksLoading,
  screenerFetchLoading,
  fullMarketLoading,
  screenerRowsLength,
  universeProgress,
}: UseAppStatusFlagsParams) {
  const progressPercent =
    universeProgress.symbolsTotal > 0
      ? Math.round((universeProgress.symbolsLoaded / universeProgress.symbolsTotal) * 100)
      : universeProgress.total > 0
        ? Math.round((universeProgress.completed / universeProgress.total) * 100)
        : 0

  const dbExpiryLabel = DB_EXPIRES_AT ? formatDbExpiryLabel(DB_EXPIRES_AT) : null
  const showDbExpiryAlert = Boolean(
    useDbScreener && dbExpiryLabel != null && new Date(`${DB_EXPIRES_AT}T23:59:59`).getTime() > Date.now()
  )

  const fullMarketStocksLoading = screenerFetchLoading || fullMarketLoading
  const screenerTableLoading =
    mode === 'manual'
      ? manualStocksLoading
      : useDbScreener
        ? screenerFetchLoading && screenerRowsLength === 0
        : fullMarketLoading

  return { progressPercent, dbExpiryLabel, showDbExpiryAlert, fullMarketStocksLoading, screenerTableLoading }
}
