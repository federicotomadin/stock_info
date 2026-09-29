import { describe, expect, it } from 'vitest'
import { countLiveEntriesToday, evaluateDayHalt, sessionPnl } from './dayPlan.js'
import { previousWeekday, reportSessionDate } from './marketHours.js'

describe('evaluateDayHalt', () => {
  it('halts new buys at the profit target', () => {
    expect(evaluateDayHalt(300, 300, 150)).toEqual({ halt: true, reason: 'profit', pnl: 300 })
    expect(evaluateDayHalt(299, 300, 150)).toEqual({ halt: false, pnl: 299 })
  })

  it('halts new buys at the daily loss cap', () => {
    expect(evaluateDayHalt(-150, 300, 150)).toEqual({ halt: true, reason: 'loss', pnl: -150 })
    expect(evaluateDayHalt(-149, 300, 150)).toEqual({ halt: false, pnl: -149 })
  })
})

describe('countLiveEntriesToday', () => {
  it('ignores a submitted order that never filled and is no longer working', () => {
    expect(
      countLiveEntriesToday(['BE', 'ALVO', 'NTSK'], new Set(['AAPL', 'ALVO', 'NTSK']), new Set())
    ).toBe(2)
  })
})

describe('reportSessionDate', () => {
  it('uses the previous weekday before the cash close', () => {
    expect(reportSessionDate(new Date('2026-09-29T14:00:00-04:00'))).toBe('2026-09-28')
    expect(previousWeekday('2026-09-28')).toBe('2026-09-25')
  })

  it('uses today after 16:05 ET', () => {
    expect(reportSessionDate(new Date('2026-09-29T16:10:00-04:00'))).toBe('2026-09-29')
  })
})
