import { fetchFmpFundamentalsBundle } from './providers/fmp.js'
import { fetchFinnhubFundamentalsBundle } from './providers/finnhub.js'
import { saveMapCacheToDisk } from './lib/cache.js'
import { FMP_FUNDAMENTALS_CACHE_FILE, FMP_FUNDAMENTALS_CACHE_TTL_MS } from './config.js'

// In-memory per-symbol fundamentals cache, persisted to disk on write and loaded at startup.
export const fmpFundamentalsCache = new Map()

/**
 * Fills FMP's gated (premium) sections from Finnhub's free data.
 * FMP data is preferred when present; Finnhub covers the rest.
 */
export function mergeFundamentals(fmp, fallback) {
  const y = fallback ?? {}

  const fallbackFields = []
  if (!fmp.keyMetricsTtm && y.keyMetricsTtm) fallbackFields.push('keyMetricsTtm')
  if (!fmp.ratiosTtm && y.ratiosTtm) fallbackFields.push('ratiosTtm')
  if (!fmp.incomeStatementAnnual?.length && y.incomeStatementAnnual?.length)
    fallbackFields.push('incomeStatement')
  if (!fmp.discountedCashFlow && y.discountedCashFlow) fallbackFields.push('discountedCashFlow')

  return {
    symbol: fmp.symbol ?? y.symbol,
    dataSource: fallbackFields.length
      ? 'financialmodelingprep.com + finnhub'
      : 'financialmodelingprep.com (stable)',
    profile: fmp.profile ?? y.profile ?? null,
    profileError: fmp.profile || y.profile ? null : (fmp.profileError ?? y.profileError ?? null),
    keyMetricsTtm: fmp.keyMetricsTtm ?? y.keyMetricsTtm ?? null,
    keyMetricsTtmError:
      fmp.keyMetricsTtm || y.keyMetricsTtm ? null : (fmp.keyMetricsTtmError ?? null),
    ratiosTtm: fmp.ratiosTtm ?? y.ratiosTtm ?? null,
    ratiosTtmError: fmp.ratiosTtm || y.ratiosTtm ? null : (fmp.ratiosTtmError ?? null),
    incomeStatementAnnual: fmp.incomeStatementAnnual?.length
      ? fmp.incomeStatementAnnual
      : (y.incomeStatementAnnual ?? []),
    incomeStatementError:
      fmp.incomeStatementAnnual?.length || y.incomeStatementAnnual?.length
        ? null
        : (fmp.incomeStatementError ?? null),
    balanceSheetAnnual: fmp.balanceSheetAnnual?.length
      ? fmp.balanceSheetAnnual
      : (y.balanceSheetAnnual ?? []),
    balanceSheetError:
      fmp.balanceSheetAnnual?.length || y.balanceSheetAnnual?.length
        ? null
        : (fmp.balanceSheetError ?? null),
    cashFlowAnnual: fmp.cashFlowAnnual?.length
      ? fmp.cashFlowAnnual
      : (y.cashFlowAnnual ?? []),
    cashFlowError:
      fmp.cashFlowAnnual?.length || y.cashFlowAnnual?.length
        ? null
        : (fmp.cashFlowError ?? null),
    discountedCashFlow: fmp.discountedCashFlow ?? y.discountedCashFlow ?? null,
    discountedCashFlowError:
      fmp.discountedCashFlow || y.discountedCashFlow
        ? null
        : (fmp.discountedCashFlowError ?? null),
    fallbackFields,
  }
}

export async function fetchFundamentalsBundle(symbol) {
  const fmp = await fetchFmpFundamentalsBundle(symbol)

  const hasFmpStatements = Boolean(fmp.incomeStatementAnnual?.length)
  const hasFmpKeyData =
    Boolean(fmp.keyMetricsTtm) && Boolean(fmp.ratiosTtm) && Boolean(fmp.discountedCashFlow)

  if (hasFmpStatements && hasFmpKeyData) {
    return fmp
  }

  try {
    const finnhub = await fetchFinnhubFundamentalsBundle(symbol)
    return mergeFundamentals(fmp, finnhub)
  } catch {
    return fmp
  }
}

const FAILED_RETRY_MS = 30 * 60 * 1000
const failedAt = new Map<string, number>()

/**
 * Same 24 h cache the /api/fmp/fundamentals endpoint uses, so the agent's veto and the UI
 * share one FMP fetch per symbol. Empty results (e.g. FMP "Limit Reach") are not cached:
 * they retry after 30 min instead of hiding data for a whole day.
 */
export async function fetchFundamentalsBundleCached(symbol: string) {
  const key = symbol.trim().toUpperCase()
  const cached = fmpFundamentalsCache.get(key)
  if (cached && Date.now() - cached.savedAt < FMP_FUNDAMENTALS_CACHE_TTL_MS) {
    return cached.value
  }

  const lastFail = failedAt.get(key)
  if (lastFail && Date.now() - lastFail < FAILED_RETRY_MS) {
    throw new Error(`Fundamentals de ${key} no disponibles (reintento en ~30 min).`)
  }

  const value = await fetchFundamentalsBundle(key)
  const hasData = Boolean(value.keyMetricsTtm || value.ratiosTtm || value.incomeStatementAnnual?.length)
  if (!hasData) {
    failedAt.set(key, Date.now())
    throw new Error(
      value.keyMetricsTtmError ?? value.profileError ?? 'Sin datos fundamentales (posible límite de FMP).'
    )
  }

  failedAt.delete(key)
  fmpFundamentalsCache.set(key, { value, savedAt: Date.now() })
  void saveMapCacheToDisk(FMP_FUNDAMENTALS_CACHE_FILE, fmpFundamentalsCache)
  return value
}
