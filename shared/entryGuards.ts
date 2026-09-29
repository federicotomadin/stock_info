import { RECOMMENDATION_GUARDS } from './trendAnalysisConstants.js'

export interface EntryGuardInput {
  label: string
  rsi14?: number | null
  monthChange?: number | null
}

/** True only when the cap is known and below the minimum; unknown caps are left to the caller. */
export function isBelowMinMarketCap(marketCap: number | null | undefined): boolean {
  return Number.isFinite(marketCap) && marketCap! < RECOMMENDATION_GUARDS.minMarketCapUsd
}

/** True when a bullish setup is already overextended and prone to an immediate pullback. */
export function isOverextendedEntry({ label, rsi14, monthChange }: EntryGuardInput): boolean {
  const { maxRsiForBullishEntry, maxMomentumMonthChange } = RECOMMENDATION_GUARDS
  const isBullishSetup = label === 'Momentum' || label === 'Early breakout'
  if (isBullishSetup && Number.isFinite(rsi14) && rsi14! > maxRsiForBullishEntry) {
    return true
  }
  return label === 'Momentum' && Number.isFinite(monthChange) && monthChange! > maxMomentumMonthChange
}
