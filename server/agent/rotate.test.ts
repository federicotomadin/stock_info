import { describe, expect, it } from 'vitest'
import { isUndersized, minSlotUsd } from './rotate.js'

describe('minSlotUsd', () => {
  it('is a share of equity per slot', () => {
    expect(minSlotUsd(150, 3, 60)).toBe(30)
  })

  it('is zero without equity', () => {
    expect(minSlotUsd(0, 3, 60)).toBe(0)
  })
})

describe('isUndersized', () => {
  it('flags one-share positions far below the slot target', () => {
    expect(isUndersized(19.64, 30)).toBe(true)
    expect(isUndersized(29.7, 30)).toBe(true)
  })

  it('keeps positions at or above the minimum', () => {
    expect(isUndersized(45, 30)).toBe(false)
  })

  it('never rotates when the minimum is disabled', () => {
    expect(isUndersized(1, 0)).toBe(false)
  })
})
