import { describe, expect, it } from 'vitest'
import { isEntryLabel, passesAgentUniverse, rankScore, resolveMarketCap } from './scan.js'
import { isUsEquitySession } from './marketHours.js'

describe('scan ranking', () => {
  it('prefers early breakouts over raw momentum at the same trend score', () => {
    expect(rankScore(50, 'Early breakout')).toBeGreaterThan(rankScore(50, 'Momentum'))
    expect(isEntryLabel('Pullback bounce')).toBe(true)
    expect(isEntryLabel('Downtrend')).toBe(false)
    expect(isEntryLabel('Neutral')).toBe(false)
  })
})

describe('resolveMarketCap', () => {
  it('prefers the database cap and falls back to Nasdaq', () => {
    expect(resolveMarketCap(3e12, 1e9)).toBe(3e12)
    expect(resolveMarketCap(null, 2.5e9)).toBe(2.5e9)
    expect(resolveMarketCap(null, undefined)).toBeNull()
  })
})

describe('passesAgentUniverse', () => {
  const held = new Set<string>()
  const base = {
    symbol: 'AAPL',
    trendLabel: 'Momentum',
    marketCap: 3e12,
    yearChange: 20,
    monthChange: 8,
    rsi14: 60,
    price: 180,
  }

  it('keeps a mid/large-cap setup', () => {
    expect(passesAgentUniverse(base, held)).toBe(true)
  })

  it('drops microcaps, unknown caps, and names already held', () => {
    expect(passesAgentUniverse({ ...base, marketCap: 111e6 }, held)).toBe(false)
    expect(passesAgentUniverse({ ...base, marketCap: null }, held)).toBe(false)
    expect(passesAgentUniverse(base, new Set(['AAPL']))).toBe(false)
  })

  it('drops overextended momentum', () => {
    expect(passesAgentUniverse({ ...base, rsi14: 82 }, held)).toBe(false)
  })
})

describe('isUsEquitySession', () => {
  it('is open on a weekday mid-session in New York', () => {
    expect(isUsEquitySession(new Date('2026-09-28T14:00:00-04:00'))).toBe(true)
  })

  it('is closed on weekends and after the cash close', () => {
    expect(isUsEquitySession(new Date('2026-09-26T14:00:00-04:00'))).toBe(false)
    expect(isUsEquitySession(new Date('2026-09-28T16:05:00-04:00'))).toBe(false)
  })
})
