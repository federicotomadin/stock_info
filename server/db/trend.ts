import { TREND_ANALYSIS } from '../../shared/trendAnalysisConstants.js'

export type TrendLabel =
  | 'Early breakout'
  | 'Reversal'
  | 'Momentum'
  | 'Pullback bounce'
  | 'Downtrend'
  | 'Neutral'

export type TrendTone = 'positive' | 'negative' | 'neutral' | 'caution' | 'speculative'

export interface TrendAnalysis {
  score: number
  label: TrendLabel
  tone: TrendTone
  detail: string
}

export interface QuoteLike {
  dayChange: number | null
  monthChange: number | null
  yearChange: number | null
}

function numberOrFallback(value: number | null | undefined, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback
}

/** Mirrors frontend analyzeTrend() so sort/filter labels stay consistent. */
export function analyzeTrend(stock: QuoteLike): TrendAnalysis {
  const hasMonth = Number.isFinite(stock.monthChange)
  const hasYear = Number.isFinite(stock.yearChange)

  if (!hasMonth && !hasYear) {
    return {
      score: 0,
      label: 'Neutral',
      tone: 'neutral',
      detail: 'Recently listed — not enough historical data to compute a trend yet.',
    }
  }

  const { missingChangeFallback, yearScoreCap, scoreWeights, patterns } = TREND_ANALYSIS

  const day = numberOrFallback(stock.dayChange, missingChangeFallback)
  const month = numberOrFallback(stock.monthChange, missingChangeFallback)
  const year = numberOrFallback(stock.yearChange, missingChangeFallback)

  // Cap year in score so +1000% 1Y lottery tickets don't outrank real Momentum setups.
  const yearForScore = Math.max(Math.min(year, yearScoreCap), -yearScoreCap)
  let score = day * scoreWeights.day + month * scoreWeights.month + yearForScore * scoreWeights.year
  let label: TrendLabel = 'Neutral'
  let tone: TrendTone = 'neutral'
  let detail = 'No clear trend signal yet.'

  const {
    earlyBreakout,
    reversal,
    momentum,
    downtrend,
    pullbackBounce,
  } = patterns

  if (
    day > earlyBreakout.thresholds.dayMin &&
    month < earlyBreakout.thresholds.monthMax &&
    year < earlyBreakout.thresholds.yearMax
  ) {
    score += earlyBreakout.scoreAdjustment
    label = 'Early breakout'
    tone = 'speculative'
    detail = 'Strong daily move but unconfirmed by longer timeframes — high risk, could reverse.'
  } else if (
    day > reversal.thresholds.dayMin &&
    month > reversal.thresholds.monthMin &&
    year < reversal.thresholds.yearMax
  ) {
    score += reversal.scoreAdjustment
    label = 'Reversal'
    tone = 'caution'
    detail = 'Short-term momentum turning positive after weak year — watch for confirmation.'
  } else if (
    day > momentum.thresholds.dayMin &&
    month > momentum.thresholds.monthMin &&
    year > momentum.thresholds.yearMin
  ) {
    score += momentum.scoreAdjustment
    label = 'Momentum'
    tone = 'positive'
    detail = 'Confirmed uptrend across day, month and year — strongest signal.'
  } else if (
    day < downtrend.thresholds.dayMax &&
    month < downtrend.thresholds.monthMax &&
    year < downtrend.thresholds.yearMax
  ) {
    score += downtrend.scoreAdjustment
    label = 'Downtrend'
    tone = 'negative'
    detail = 'Weakness remains across all tracked windows — avoid.'
  } else if (
    day > pullbackBounce.thresholds.dayMin &&
    month < pullbackBounce.thresholds.monthMax &&
    year > pullbackBounce.thresholds.yearMin
  ) {
    score += pullbackBounce.scoreAdjustment
    label = 'Pullback bounce'
    tone = 'caution'
    detail = 'Positive day while month is in correction — timing uncertain.'
  }

  return { score, label, tone, detail }
}
