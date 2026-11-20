import { describe, expect, it } from 'vitest'
import {
  checkBlockedTicker,
  evaluateFundamentalsHard,
  mrMarketLabelBoost,
  parseAgentSymbolList,
} from './buffettGuard.js'

const thresholds = { minRoePct: 8, maxDebtToEquity: 2.5, minNetMarginPct: 0 }

describe('buffettGuard', () => {
  it('parses blocked tickers', () => {
    expect(parseAgentSymbolList('abc, XYZ')).toEqual(new Set(['ABC', 'XYZ']))
  })

  it('blocks listed ticker', () => {
    const r = checkBlockedTicker('abc', new Set(['ABC']))
    expect(r.ok).toBe(false)
  })

  it('rejects low ROE when known', () => {
    const r = evaluateFundamentalsHard(
      {
        keyMetricsTtm: { roeTTM: 5 },
        ratiosTtm: null,
        profile: null,
        discountedCashFlow: null,
        dataSource: 'test',
      } as never,
      thresholds
    )
    expect(r.ok).toBe(false)
  })

  it('penalizes hot momentum', () => {
    expect(mrMarketLabelBoost('Momentum', 70, 10, true)).toBeLessThan(0)
    expect(mrMarketLabelBoost('Momentum', 50, 10, false)).toBe(4)
  })
})