import { describe, expect, it } from 'vitest'
import { defaultProtectiveStop, plannedStop } from './stops.js'

describe('plannedStop', () => {
  it('moves to break-even after a +1R move', () => {
    const next = plannedStop({
      avgCost: 100,
      originalStop: 95,
      currentStop: 95,
      currentPrice: 105,
      supports: [],
      sma20: null,
      downtrend: false,
    })

    expect(next).toMatchObject({ reason: 'breakeven', stop: 100.2 })
  })

  it('never lowers an existing stop', () => {
    const next = plannedStop({
      avgCost: 100,
      originalStop: 95,
      currentStop: 102,
      currentPrice: 103,
      supports: [90],
      sma20: 98,
      downtrend: false,
    })

    expect(next).toBeNull()
  })

  it('trails under a higher support', () => {
    const next = plannedStop({
      avgCost: 100,
      originalStop: 95,
      currentStop: 95,
      currentPrice: 110,
      supports: [104],
      sma20: 101,
      downtrend: false,
    })

    expect(next?.reason).toBe('support')
    expect(next?.stop).toBe(103.48)
  })

  it('tightens on a downtrend', () => {
    const next = plannedStop({
      avgCost: 100,
      originalStop: 95,
      currentStop: 95,
      currentPrice: 99,
      supports: [],
      sma20: null,
      downtrend: true,
    })

    expect(next).toMatchObject({ reason: 'downtrend', stop: 97.52 })
  })
})

describe('defaultProtectiveStop', () => {
  it('uses the tighter of cost and last price', () => {
    expect(defaultProtectiveStop(110, 100, 5)).toBe(95)
  })
})
