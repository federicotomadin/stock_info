import { numberOrFallback } from './utils'
import type { EnrichedStock, InvestmentGoalId, RiskProfile, TrendLabel } from './types/stock'

export type PreferredHorizon = 'short' | 'medium' | 'long'

const AGGRESSIVE_TRENDS = new Set<TrendLabel>([
  'Momentum',
  'Early breakout',
  'Reversal',
  'Pullback bounce',
])

export const horizonByTrendLabel = (
  label: TrendLabel,
  profile: RiskProfile,
  preferredHorizon: PreferredHorizon = 'medium',
): string => {
  if (label === 'Downtrend') {
    return 'Watchlist (avoid entry for now)'
  }

  if (preferredHorizon === 'short') {
    if (label === 'Early breakout' || label === 'Reversal' || label === 'Pullback bounce') {
      return '1-3 months'
    }
    if (label === 'Momentum') {
      return profile === 'Conservative' ? '3-6 months' : '1-3 months'
    }
    return '1-3 months'
  }

  if (preferredHorizon === 'long') {
    if (label === 'Early breakout' || label === 'Reversal') {
      return profile === 'Aggressive' ? '3-6 months' : '6-12 months'
    }
    return '1+ years'
  }

  if (label === 'Early breakout' || label === 'Reversal') {
    return profile === 'Aggressive' ? '1-3 months' : '3-6 months'
  }
  if (label === 'Momentum') {
    return profile === 'Conservative' ? '6-12 months' : '3-9 months'
  }
  if (label === 'Pullback bounce') {
    return profile === 'Conservative' ? '3-6 months' : '1-3 months'
  }
  if (label === 'Neutral') {
    return profile === 'Aggressive' ? '3-6 months' : '6-12 months'
  }
  return 'Watchlist (avoid entry for now)'
}

const cappedPositive = (value: number, cap: number): number => Math.min(Math.max(value, 0), cap)

export const passesRiskProfileFilter = (
  stock: EnrichedStock,
  profile: RiskProfile,
  preferredHorizon: PreferredHorizon = 'medium',
): boolean => {
  const label = stock.trend?.label ?? 'Neutral'
  if (label === 'Downtrend') {
    return false
  }

  const day = Math.abs(numberOrFallback(stock.dayChange, 0))
  const year = Math.abs(numberOrFallback(stock.yearChange, 0))

  if (profile === 'Conservative') {
    if (year > 55) return false
    if (day > 8) return false
    if (label === 'Early breakout' || label === 'Reversal') return false
    return label === 'Momentum' || label === 'Pullback bounce' || (label === 'Neutral' && year < 35)
  }

  if (profile === 'Aggressive') {
    // High risk = actionable setups only. Neutral mega-runners are noise, not momentum.
    if (!AGGRESSIVE_TRENDS.has(label)) return false
    if (preferredHorizon === 'short' && label === 'Pullback bounce' && day < 1) return false
    return true
  }

  if (year > 100) return false
  if (day > 15 && label === 'Early breakout' && year > 60) return false
  if (label === 'Neutral' && year > 70) return false
  return true
}

export const recommendationScore = (
  stock: EnrichedStock,
  profile: RiskProfile,
  goals: InvestmentGoalId[],
  preferredHorizon: PreferredHorizon = 'medium',
): number => {
  const day = numberOrFallback(stock.dayChange, -100)
  const month = numberOrFallback(stock.monthChange, -100)
  const year = numberOrFallback(stock.yearChange, -100)
  const trendLabel = stock.trend?.label ?? 'Neutral'

  const shortTermVolatility = Math.abs(day) + Math.abs(month) * 0.4
  const extremeYearMove = Math.abs(year) > 60 ? (Math.abs(year) - 60) * 0.45 : 0

  const yearCap = preferredHorizon === 'short' ? 40 : preferredHorizon === 'long' ? 80 : 55
  const yearClamped = Math.max(Math.min(year, yearCap), -yearCap)

  const dayW = preferredHorizon === 'short' ? 2.1 : preferredHorizon === 'long' ? 0.55 : 1.2
  const monthW = preferredHorizon === 'short' ? 0.85 : preferredHorizon === 'long' ? 0.45 : 0.7
  const yearW = preferredHorizon === 'short' ? 0.08 : preferredHorizon === 'long' ? 0.35 : 0.18

  // Do not reuse raw trend.score — it was year-dominated and drowned Momentum.
  let score = 0

  if (trendLabel === 'Neutral') score -= 20
  if (trendLabel === 'Momentum') score += profile === 'Aggressive' ? 28 : 10
  if (trendLabel === 'Early breakout' || trendLabel === 'Reversal') {
    score += profile === 'Aggressive' ? 22 : 4
  }
  if (trendLabel === 'Pullback bounce') score += profile === 'Conservative' ? 8 : 6

  if (profile === 'Conservative') {
    score += cappedPositive(month, 25) * 0.9 + cappedPositive(yearClamped, 35) * 0.5
    score -= shortTermVolatility * 0.7
    score -= extremeYearMove
    if (trendLabel === 'Momentum') score += 8
    if (trendLabel === 'Pullback bounce') score += 4
    if (trendLabel === 'Early breakout' || trendLabel === 'Reversal') score -= 10
  } else if (profile === 'Aggressive') {
    score += day * dayW + month * monthW + yearClamped * yearW
    score += shortTermVolatility * (preferredHorizon === 'short' ? 0.35 : 0.15)
    // Prefer confirmed Momentum over one-day lottery breakouts when both qualify.
    if (trendLabel === 'Momentum') score += 12
    if (trendLabel === 'Early breakout') score += preferredHorizon === 'short' ? 10 : 4
    if (trendLabel === 'Reversal') score += 8
  } else {
    score += day * 0.45 + month * 0.75 + cappedPositive(yearClamped, 50) * 0.35
    score -= extremeYearMove * 0.4
    if (trendLabel === 'Momentum' || trendLabel === 'Reversal') score += 5
    if (trendLabel === 'Neutral') score -= 6
  }

  if (goals.includes('dividends')) {
    score += year > 0 && year < 40 ? 4 : year > 0 ? 1 : -2
    score -= Math.abs(day) * 0.25
  }
  if (goals.includes('stability')) {
    score -= shortTermVolatility * 0.5
    score += month > 0 && month < 20 ? 4 : month > 0 ? 1 : -2
    if (Math.abs(year) > 80) score -= 10
  }
  if (goals.includes('growth')) {
    if (profile === 'Conservative') {
      score += cappedPositive(month, 20) * 0.45 + cappedPositive(yearClamped, 35) * 0.2
    } else if (profile === 'Aggressive') {
      score += month * monthW * 0.7 + day * dayW * 0.25
      if (trendLabel === 'Momentum') score += 6
    } else {
      score += month * 0.4 + cappedPositive(yearClamped, 55) * 0.25
    }
  }
  if (goals.includes('value')) {
    if (trendLabel === 'Reversal' || trendLabel === 'Pullback bounce') {
      score += profile === 'Aggressive' ? 5 : 4
    }
  }

  return score
}
