import { describe, expect, it } from 'vitest'
import { buildDailyReportHtml } from './report.js'

describe('buildDailyReportHtml', () => {
  it('lists buys, sells and session P&L', () => {
    const html = buildDailyReportHtml({
      day: '2026-09-28',
      pnl: -31.92,
      openNl: 1_000_000,
      closeNl: 999_968.08,
      buys: [{ symbol: 'ALVO', quantity: 162, avg: 6.16, notional: 998 }],
      sells: [],
    })

    expect(html).toContain('2026-09-28')
    expect(html).toContain('ALVO')
    expect(html).toContain('No hubo ventas ejecutadas')
  })
})
