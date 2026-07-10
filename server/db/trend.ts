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

  const day = numberOrFallback(stock.dayChange, -100)
  const month = numberOrFallback(stock.monthChange, -100)
  const year = numberOrFallback(stock.yearChange, -100)
  const acceleration = day - month / 21

  let score = day * 0.55 + month * 0.35 + year * 0.1
  let label: TrendLabel = 'Neutral'
  let tone: TrendTone = 'neutral'
  let detail = 'No clear trend signal yet.'

  if (day > 1.1 && month < 4 && year < 18) {
    score += 10
    label = 'Early breakout'
    tone = 'speculative'
    detail = 'Strong daily move but unconfirmed by longer timeframes — high risk, could reverse.'
  } else if (day > 0.4 && month > 0 && year < 0) {
    score += 14
    label = 'Reversal'
    tone = 'caution'
    detail = 'Short-term momentum turning positive after weak year — watch for confirmation.'
  } else if (day > 0 && month > 6 && year > 12 && acceleration > -0.8) {
    score += 5
    label = 'Momentum'
    tone = 'positive'
    detail = 'Confirmed uptrend across day, month and year — strongest signal.'
  } else if (day < 0 && month < 0 && year < 0) {
    score -= 8
    label = 'Downtrend'
    tone = 'negative'
    detail = 'Weakness remains across all tracked windows — avoid.'
  } else if (day > 0 && month < 0 && year > 0) {
    score += 3
    label = 'Pullback bounce'
    tone = 'caution'
    detail = 'Positive day while month is in correction — timing uncertain.'
  }

  return { score, label, tone, detail }
}
