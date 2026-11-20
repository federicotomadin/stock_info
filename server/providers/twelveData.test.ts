import { describe, expect, it } from 'vitest'
import { parseTwelveDataCandles } from './twelveData.js'

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)
    return { datetime: day, open: '10', high: '11', low: '9', close: '10.5', volume: '1000' }
  }).reverse() // Twelve Data returns newest first

describe('parseTwelveDataCandles', () => {
  it('returns ascending candles from newest-first values', () => {
    const candles = parseTwelveDataCandles({ status: 'ok', values: rows(35) }, 'AAPL')
    expect(candles).toHaveLength(35)
    expect(candles[0].date < candles[34].date).toBe(true)
    expect(candles[0].close).toBe(10.5)
  })

  it('throws on an error payload (e.g. rate limit)', () => {
    expect(() =>
      parseTwelveDataCandles({ code: 429, status: 'error', message: 'run out of API credits' }, 'AAPL')
    ).toThrow(/run out of API credits/)
  })

  it('throws when there are too few rows', () => {
    expect(() => parseTwelveDataCandles({ status: 'ok', values: rows(10) }, 'AAPL')).toThrow(/only 10/)
  })

  it('drops invalid bars', () => {
    const values = [...rows(31), { datetime: '2026-03-01', open: 'x', high: '1', low: '1', close: '1', volume: '1' }]
    expect(parseTwelveDataCandles({ status: 'ok', values }, 'AAPL')).toHaveLength(31)
  })
})
