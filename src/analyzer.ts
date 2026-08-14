import { numberOrFallback } from './utils'
import type { EnrichedStock, InvestmentGoalId, RiskProfile, TrendLabel } from './types/stock'

export const horizonByTrendLabel = (label: TrendLabel, profile: RiskProfile): string => {
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
    return '6-12 months'
  }
  return 'Watchlist (avoid entry for now)'
}

const cappedPositive = (value: number, cap: number): number => Math.min(Math.max(value, 0), cap)

export const passesRiskProfileFilter = (
  stock: EnrichedStock,
  profile: RiskProfile,
): boolean => {
  if (stock.trend?.label === 'Downtrend') {
    return false
  }

  const year = Math.abs(numberOrFallback(stock.yearChange, 0))
  if (profile === 'Conservative' && year > 70) {
    return false
  }

  return true
}

export const recommendationScore = (
  stock: EnrichedStock,
  profile: RiskProfile,
  goals: InvestmentGoalId[],
): number => {
  const day = numberOrFallback(stock.dayChange, -100)
  const month = numberOrFallback(stock.monthChange, -100)
  const year = numberOrFallback(stock.yearChange, -100)
  const trendScore = stock.trend?.score ?? 0
  const trendLabel = stock.trend?.label ?? 'Neutral'

  const shortTermVolatility = Math.abs(day) + Math.abs(month) * 0.4
  const extremeYearMove = Math.abs(year) > 60 ? (Math.abs(year) - 60) * 0.45 : 0

  let score = trendScore

  if (profile === 'Conservative') {
    score += cappedPositive(month, 25) * 0.85 + cappedPositive(year, 35) * 0.55
    score -= shortTermVolatility * 0.65
    score -= extremeYearMove
    if (trendLabel === 'Momentum') score += 10
    if (trendLabel === 'Pullback bounce') score += 4
    if (trendLabel === 'Early breakout' || trendLabel === 'Reversal') score -= 8
  } else if (profile === 'Aggressive') {
    score += day * 1.45 + month * 0.55 + year * 0.12
    score += shortTermVolatility * 0.2
    if (trendLabel === 'Early breakout' || trendLabel === 'Reversal') score += 12
    if (trendLabel === 'Momentum') score += 5
  } else {
    score += day * 0.45 + month * 0.75 + cappedPositive(year, 50) * 0.4
    score -= extremeYearMove * 0.35
    if (trendLabel === 'Momentum' || trendLabel === 'Reversal') score += 4
  }

  if (goals.includes('dividends')) {
    score += year > 0 && year < 40 ? 4 : year > 0 ? 1 : -2
    score -= Math.abs(day) * 0.25
  }
  if (goals.includes('stability')) {
    score -= shortTermVolatility * 0.45
    score += month > 0 && month < 20 ? 3 : month > 0 ? 1 : -1
  }
  if (goals.includes('growth')) {
    if (profile === 'Conservative') {
      score += cappedPositive(month, 20) * 0.45 + cappedPositive(year, 35) * 0.2
    } else if (profile === 'Aggressive') {
      score += month * 0.55 + day * 0.35
    } else {
      score += month * 0.4 + cappedPositive(year, 55) * 0.25
    }
  }
  if (goals.includes('value')) {
    if (trendLabel === 'Reversal' || trendLabel === 'Pullback bounce') {
      score += profile === 'Aggressive' ? 5 : 4
    }
  }

  return score
}
