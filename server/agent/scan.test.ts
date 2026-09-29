import { describe, expect, it } from 'vitest'
import { isEntryLabel, rankScore } from './scan.js'
import { isUsEquitySession } from './marketHours.js'

describe('scan ranking', () => {
  it('prefers early breakouts over raw momentum at the same trend score', () => {
    expect(rankScore(50, 'Early breakout')).toBeGreaterThan(rankScore(50, 'Momentum'))
    expect(isEntryLabel('Pullback bounce')).toBe(true)
    expect(isEntryLabel('Downtrend')).toBe(false)
    expect(isEntryLabel('Neutral')).toBe(false)
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
