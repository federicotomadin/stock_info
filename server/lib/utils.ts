import { MAX_SYMBOLS } from '../config.js'

export function toPercent(current, base) {
  if (!Number.isFinite(current) || !Number.isFinite(base) || base === 0) {
    return null
  }

  return ((current - base) / base) * 100
}

export function parseSymbols(rawInput = '') {
  const parsed = rawInput
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)

  return Array.from(new Set(parsed)).slice(0, MAX_SYMBOLS)
}

export function toStooqTicker(symbol) {
  return symbol.includes('.') ? symbol.toLowerCase() : `${symbol.toLowerCase()}.us`
}

export function toYahooTicker(symbol) {
  return symbol.replaceAll('.', '-')
}

export function formatIsoDateFromUnix(seconds) {
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

export function findCloseAtOrBefore(closes, index) {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const value = closes[cursor]
    if (Number.isFinite(value)) {
      return value
    }
  }
  return null
}

export function cleanBusinessSummary(summary = '') {
  return summary.replace(/\s+/g, ' ').trim()
}

export function numOrNull(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : 'N/A'
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function stripJsonCodeFence(text = '') {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim()
}

export function parseAiAnalysisJson(rawText) {
  const cleaned = stripJsonCodeFence(rawText)
  try {
    return JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        return JSON.parse(match[0])
      } catch {
        return null
      }
    }
    return null
  }
}

export function extractFoundedYear(text = '') {
  const foundedMatch = text.match(
    /\b(?:founded|incorporated|established)\s+(?:in\s+)?((?:18|19|20)\d{2})\b/i
  )
  if (foundedMatch) {
    return Number(foundedMatch[1])
  }

  return null
}

export function inferSectorFromIndustry(industry = '') {
  const text = industry.toUpperCase()

  if (text.includes('SEMICONDUCTOR') || text.includes('SOFTWARE') || text.includes('TECH')) {
    return 'Technology'
  }
  if (
    text.includes('BANK') ||
    text.includes('FINANC') ||
    text.includes('PAYMENT') ||
    text.includes('INSURANCE')
  ) {
    return 'Financial Services'
  }
  if (text.includes('PHARMA') || text.includes('BIOTECH') || text.includes('HEALTH')) {
    return 'Healthcare'
  }
  if (text.includes('ENERGY') || text.includes('OIL') || text.includes('GAS')) {
    return 'Energy'
  }
  if (
    text.includes('INDUSTR') ||
    text.includes('ALUMIN') ||
    text.includes('MANUFACTUR') ||
    text.includes('AEROSPACE')
  ) {
    return 'Industrials'
  }
  if (
    text.includes('RETAIL') ||
    text.includes('E-COMMERCE') ||
    text.includes('CONSUMER')
  ) {
    return 'Consumer'
  }

  return 'Unknown'
}

export function inferSectorIndustry(text = '') {
  const source = text.toUpperCase()
  const has = (tokens) => tokens.some((token) => source.includes(token))

  if (has(['SEMICONDUCTOR', 'CHIP', 'MICROPROCESSOR'])) {
    return { sector: 'Technology', industry: 'Semiconductors' }
  }
  if (has(['BANK', 'FINTECH', 'PAYMENT', 'INSURANCE', 'FINANCIAL'])) {
    return { sector: 'Financial Services', industry: 'Financials / Fintech' }
  }
  if (has(['PHARM', 'BIOTECH', 'HEALTHCARE', 'MEDICAL'])) {
    return { sector: 'Healthcare', industry: 'Biotech / Healthcare' }
  }
  if (has(['OIL', 'GAS', 'ENERGY', 'PETROLEUM', 'RENEWABLE'])) {
    return { sector: 'Energy', industry: 'Energy' }
  }
  if (has(['SOFTWARE', 'CLOUD', 'INTERNET', 'PLATFORM', 'SAAS'])) {
    return { sector: 'Technology', industry: 'Software / Internet' }
  }
  if (has(['AEROSPACE', 'INDUSTRIAL', 'ALUMINUM', 'STEEL', 'MACHINERY'])) {
    return { sector: 'Industrials', industry: 'Industrial Manufacturing' }
  }
  if (has(['RETAIL', 'CONSUMER', 'E-COMMERCE', 'FOOD', 'BEVERAGE'])) {
    return { sector: 'Consumer', industry: 'Consumer Goods / Services' }
  }

  return { sector: null, industry: null }
}
