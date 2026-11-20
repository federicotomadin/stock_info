export type FundBundle = Awaited<ReturnType<typeof import('../fundamentals.js').fetchFundamentalsBundle>>

const num = (value: unknown): number | null => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function extractFundamentalMetrics(bundle: FundBundle) {
  const km = bundle.keyMetricsTtm as Record<string, unknown> | null
  const ratios = bundle.ratiosTtm as Record<string, unknown> | null
  const profile = bundle.profile as Record<string, unknown> | null

  const roe =
    num(km?.roeTTM) ??
    num(km?.roe) ??
    num(km?.returnOnEquityTTM) ??
    num(ratios?.returnOnEquityTTM)

  const debtToEquity =
    num(km?.debtToEquityTTM) ??
    num(km?.debtToEquity) ??
    num(ratios?.debtToEquityRatioTTM) ??
    num(ratios?.debtToEquity)

  const netMargin = num(ratios?.netProfitMarginTTM) ?? num(ratios?.netProfitMargin)

  const sector = typeof profile?.sector === 'string' ? profile.sector.trim() : null
  const industry = typeof profile?.industry === 'string' ? profile.industry.trim() : null

  const dcf = bundle.discountedCashFlow as { dcf?: number; stockPrice?: number } | null
  const dcfValue = num(dcf?.dcf)
  const dcfPrice = num(dcf?.stockPrice)

  return { roe, debtToEquity, netMargin, sector, industry, dcfValue, dcfPrice }
}

export function formatFundamentalsBrief(bundle: FundBundle): string {
  const m = extractFundamentalMetrics(bundle)
  const lines = [
    m.sector ? `Sector: ${m.sector}` : '',
    m.industry ? `Industry: ${m.industry}` : '',
    m.roe != null ? `ROE (TTM): ${m.roe.toFixed(1)}%` : 'ROE (TTM): n/a',
    m.netMargin != null ? `Net margin (TTM): ${m.netMargin.toFixed(1)}%` : 'Net margin (TTM): n/a',
    m.debtToEquity != null ? `Debt/equity: ${m.debtToEquity.toFixed(2)}` : 'Debt/equity: n/a',
  ]
  if (m.dcfValue != null && m.dcfPrice != null && m.dcfPrice > 0) {
    const gapPct = ((m.dcfValue - m.dcfPrice) / m.dcfPrice) * 100
    lines.push(`DCF vs price: ${gapPct >= 0 ? '+' : ''}${gapPct.toFixed(0)}% (rough margin-of-safety proxy)`)
  }
  lines.push(`Source: ${bundle.dataSource ?? 'unknown'}`)
  return lines.filter(Boolean).join('\n')
}