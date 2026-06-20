import { MAX_SYMBOLS } from './constants/app'
import { TREND_MEANINGS } from './models/constants'
import type { TrendLabel } from './types/stock'

export const parseSymbols = (rawInput: string): string[] => {
  const parsed = rawInput
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)

  return Array.from(new Set(parsed)).slice(0, MAX_SYMBOLS)
}

export const formatPercent = (value: number | null): string => {
  if (value === null || Number.isNaN(value)) {
    return 'N/A'
  }

  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

export const metricClass = (value: number | null): string => {
  if (value === null || Number.isNaN(value)) {
    return ''
  }

  if (value > 0) {
    return 'positive'
  }

  if (value < 0) {
    return 'negative'
  }

  return 'neutral'
}

export const numberOrFallback = (value: number | null, fallback = 0): number => {
  if (value === null || Number.isNaN(value)) {
    return fallback
  }

  return value
}

export const trendTooltip = (label: TrendLabel, detail: string): string => {
  return `${label}: ${TREND_MEANINGS[label] ?? detail}`
}

export const cleanCompanyName = (name: string | null | undefined): string | null => {
  if (!name) {
    return null
  }

  return name
    .replace(/\s*-\s*Common Stock$/i, '')
    .replace(/\s*Common Stock$/i, '')
    .trim()
}
