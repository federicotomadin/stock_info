import { fetchFmpFundamentalsBundle } from './providers/fmp.js'
import { fetchFinnhubFundamentalsBundle } from './providers/finnhub.js'

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
