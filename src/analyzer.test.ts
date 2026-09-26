import { describe, expect, it } from 'vitest'
import { passesRiskProfileFilter } from './analyzer'
import type { EnrichedStock, TrendLabel } from './types/stock'

const stock = (overrides: Partial<EnrichedStock> & { label?: TrendLabel } = {}): EnrichedStock => {
  const { label = 'Momentum', ...rest } = overrides
  return {
    symbol: 'TEST',
    price: 10,
    updatedAt: '2026-09-25',
    dayChange: 1,
    monthChange: 10,
    yearChange: 30,
    rsi14: 60,
    country: 'US',
    trend: { score: 0, label, tone: 'positive', detail: '' },
    ...rest,
  }
}

describe('passesRiskProfileFilter chase-risk guards', () => {
  it('keeps a healthy Momentum setup', () => {
    expect(passesRiskProfileFilter(stock(), 'Aggressive')).toBe(true)
  })

  it('drops recent listings without a full year of history', () => {
    expect(passesRiskProfileFilter(stock({ yearChange: null }), 'Conservative')).toBe(false)
  })

  it('drops overbought Momentum and Early breakout entries', () => {
    expect(passesRiskProfileFilter(stock({ rsi14: 80 }), 'Aggressive')).toBe(false)
    expect(
      passesRiskProfileFilter(stock({ label: 'Early breakout', rsi14: 80 }), 'Aggressive')
    ).toBe(false)
  })

  it('drops Momentum after a blow-off monthly run', () => {
    expect(passesRiskProfileFilter(stock({ monthChange: 55 }), 'Aggressive')).toBe(false)
  })

  it('keeps Momentum when RSI is unavailable', () => {
    expect(passesRiskProfileFilter(stock({ rsi14: null }), 'Moderate')).toBe(true)
  })
})
