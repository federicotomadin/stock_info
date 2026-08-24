import { describe, expect, it } from 'vitest'
import { rsi, sma } from './indicators.js'

describe('indicators', () => {
  it('computes a simple moving average', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toBeCloseTo(4)
    expect(sma([1, 2], 5)).toBeNull()
  })

  it('computes RSI', () => {
    const rising = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    expect(rsi(rising, 14)).toBeCloseTo(100)

    const flat = Array(20).fill(10)
    expect(rsi(flat, 14)).toBe(100)
  })
})
