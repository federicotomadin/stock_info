import { MAX_SYMBOLS } from './constants/app'
import { TREND_MEANINGS } from './models/constants'
import type { TrendLabel } from './types/stock'

/** Splits a comma-separated ticker string into unique, uppercased symbols, capped at MAX_SYMBOLS. */
export const parseSymbols = (rawInput: string): string[] => {
  const parsed = rawInput
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)

  return Array.from(new Set(parsed)).slice(0, MAX_SYMBOLS)
}

/** Formats a change value as a signed percentage string (e.g. "+3.25%"), or "N/A" when missing. */
export const formatPercent = (value: number | null): string => {
  if (value === null || Number.isNaN(value)) {
    return 'N/A'
  }

  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

/** Maps a change value to a CSS class name ("positive"/"negative"/"neutral") for styling. */
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

/** Returns `value` unless it's null/NaN, in which case it returns `fallback`. */
export const numberOrFallback = (value: number | null, fallback = 0): number => {
  if (value === null || Number.isNaN(value)) {
    return fallback
  }

  return value
}

/** Builds the tooltip text for a trend chip: known label meaning, falling back to its own detail. */
export const trendTooltip = (label: TrendLabel, detail: string): string => {
  return `${label}: ${TREND_MEANINGS[label] ?? detail}`
}

/** Strips the "- Common Stock" / "Common Stock" suffix some data providers append to company names. */
export const cleanCompanyName = (name: string | null | undefined): string | null => {
  if (!name) {
    return null
  }

  return name
    .replace(/\s*-\s*Common Stock$/i, '')
    .replace(/\s*Common Stock$/i, '')
    .trim()
}
