import { describe, expect, it } from 'vitest'
import type { OrderLimits } from './config.js'
import { buildBracketProposal, type BracketProposalInput } from './proposal.js'

const limits: OrderLimits = {
  maxOrderUsd: 1000,
  maxOrdersPerDay: 3,
  defaultStopPct: 5,
  minStopPct: 2,
  maxStopPct: 10,
  rewardRiskRatio: 2,
  minPrice: 1,
  proposalTtlMs: 60_000,
}

const input = (overrides: Partial<BracketProposalInput> = {}): BracketProposalInput => ({
  symbol: 'AAPL',
  price: 100,
  budgetUsd: 1000,
  supports: [],
  trendLabel: 'Momentum',
  yearChange: 25,
  monthChange: 8,
  rsi14: 60,
  ...overrides,
})

describe('buildBracketProposal', () => {
  it('uses the nearest support below price as the stop when within range', () => {
    const result = buildBracketProposal(input({ supports: [{ level: 90 }, { level: 95 }, { level: 105 }] }), limits)

    expect(result).toMatchObject({
      ok: true,
      proposal: { quantity: 10, entryPrice: 100, stopLoss: 94.53, takeProfit: 110.94, stopSource: 'support' },
    })
  })

  it('falls back to the default % stop when support is too close or too far', () => {
    const tooClose = buildBracketProposal(input({ supports: [{ level: 99.5 }] }), limits)
    const tooFar = buildBracketProposal(input({ supports: [{ level: 70 }] }), limits)

    expect(tooClose).toMatchObject({ ok: true, proposal: { stopLoss: 95, takeProfit: 110, stopSource: 'percent' } })
    expect(tooFar).toMatchObject({ ok: true, proposal: { stopLoss: 95, stopSource: 'percent' } })
  })

  it('reports notional and dollar risk for the whole position', () => {
    const result = buildBracketProposal(input({ budgetUsd: 550 }), limits)

    expect(result).toMatchObject({ ok: true, proposal: { quantity: 5, notionalUsd: 500, riskUsd: 25 } })
  })

  it.each([
    ['budget above the per-order cap', { budgetUsd: 5000 }],
    ['non-positive budget', { budgetUsd: 0 }],
    ['budget smaller than one share', { budgetUsd: 50 }],
    ['penny stock', { price: 0.5 }],
    ['recent listing without a year of history', { yearChange: null }],
    ['downtrend', { trendLabel: 'Downtrend' }],
    ['overbought momentum', { rsi14: 82 }],
    ['blow-off monthly run', { monthChange: 60 }],
  ])('rejects %s', (_case, overrides) => {
    expect(buildBracketProposal(input(overrides), limits).ok).toBe(false)
  })
})
