import { describe, expect, it } from 'vitest'
import { buildStockFromSortedDailyCloses } from './stock.js'
import { analyzeTrend } from '../db/trend.js'

const risingSeries = (length: number) =>
  Array.from({ length }, (_, index) => 10 * 1.005 ** index)

describe('buildStockFromSortedDailyCloses', () => {
  it('leaves month/year change null when the listing is younger than the window', () => {
    const quote = buildStockFromSortedDailyCloses('IPO', risingSeries(15), '2026-09-25')

    expect(quote.dayChange).not.toBeNull()
    expect(quote.monthChange).toBeNull()
    expect(quote.yearChange).toBeNull()
  })

  it('computes month but not year change for a stock listed a few months ago', () => {
    const quote = buildStockFromSortedDailyCloses('IPO', risingSeries(120), '2026-09-25')

    expect(quote.monthChange).not.toBeNull()
    expect(quote.yearChange).toBeNull()
  })

  it('computes year change once a full year of sessions exists', () => {
    const quote = buildStockFromSortedDailyCloses('OLD', risingSeries(400), '2026-09-25')

    expect(quote.yearChange).not.toBeNull()
  })
})

describe('analyzeTrend for recent listings', () => {
  it('does not label a post-IPO pop as Momentum', () => {
    const quote = buildStockFromSortedDailyCloses('IPO', risingSeries(120), '2026-09-25')

    expect(analyzeTrend(quote).label).toBe('Neutral')
  })

  it('still labels a seasoned uptrend as Momentum', () => {
    const quote = buildStockFromSortedDailyCloses('OLD', risingSeries(400), '2026-09-25')

    expect(analyzeTrend(quote).label).toBe('Momentum')
  })
})
