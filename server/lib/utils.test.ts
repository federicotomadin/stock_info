import { describe, expect, it } from 'vitest'
import {
  cleanBusinessSummary,
  inferSectorFromIndustry,
  parseSymbols,
  toPercent,
  toStooqTicker,
  toYahooTicker,
} from './utils.js'

describe('utils', () => {
  it('parses and dedupes symbols', () => {
    expect(parseSymbols(' aapl , MSFT,aapl ,,nvda ')).toEqual(['AAPL', 'MSFT', 'NVDA'])
  })

  it('maps tickers to providers', () => {
    expect(toYahooTicker('BRK.B')).toBe('BRK-B')
    expect(toStooqTicker('AAPL')).toBe('aapl.us')
    expect(toStooqTicker('PETR4.SA')).toBe('petr4.sa')
  })

  it('computes percent change safely', () => {
    expect(toPercent(110, 100)).toBeCloseTo(10)
    expect(toPercent(100, 0)).toBeNull()
    expect(toPercent(Number.NaN, 100)).toBeNull()
  })

  it('normalises whitespace in summaries', () => {
    expect(cleanBusinessSummary('  hello\n   world   ')).toBe('hello world')
  })

  it('infers a sector from an industry string', () => {
    expect(inferSectorFromIndustry('Semiconductors')).toBe('Technology')
    expect(inferSectorFromIndustry('Banks—Regional')).toBe('Financial Services')
    expect(inferSectorFromIndustry('')).toBe('Unknown')
  })
})
