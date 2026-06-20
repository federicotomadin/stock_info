import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cleanCompanyName } from './utils'
import { apiEndpoint } from './servicesAPI'

interface FundamentalsViewProps {
  symbol: string
  onBackToScreener: () => void
}

interface FmpFundamentalsPayload {
  [key: string]: unknown
  profile?: Record<string, unknown> | null
  keyMetricsTtm?: Record<string, unknown> | null
  ratiosTtm?: Record<string, unknown> | null
  discountedCashFlow?: Record<string, unknown> | null
  incomeStatementAnnual?: Array<Record<string, unknown>>
}

function str(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return fallback
  return String(value)
}

function formatCompactNumber(value: unknown): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return 'N/A'
  }
  const n = Number(value)
  const abs = Math.abs(n)
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`
  return n.toFixed(2)
}

function formatRatio(value: unknown, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return 'N/A'
  }
  return Number(value).toFixed(digits)
}

/** FMP often returns decimals (0.15 = 15%); sometimes already as a percentage. */
function formatPctFlexible(value: unknown): string | null {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return null
  }
  const n = Number(value)
  if (Math.abs(n) <= 1) {
    return `${formatRatio(n * 100, 2)}%`
  }
  return `${formatRatio(n, 2)}%`
}

function pickDefinedRow(label: string, value: ReactNode) {
  if (value === null || value === undefined || value === '') {
    return null
  }
  return (
    <div className="fundamentals-dl-row" key={label}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function TradingViewChart({ symbol }: { symbol: string }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    container.innerHTML = ''

    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
    script.type = 'text/javascript'
    script.async = true
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: 'D',
      timezone: 'Etc/UTC',
      theme: 'light',
      style: '1',
      locale: 'en',
      allow_symbol_change: false,
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: false,
      calendar: false,
      support_host: 'https://www.tradingview.com',
    })

    container.appendChild(script)

    return () => { container.innerHTML = '' }
  }, [symbol])

  return (
    <div className="tradingview-widget-container" ref={containerRef}>
      <div className="tradingview-widget-container__widget" />
    </div>
  )
}

function isRateLimited(payload: FmpFundamentalsPayload | null): boolean {
  if (!payload) return false
  const errorFields = [
    'profileError', 'keyMetricsTtmError', 'ratiosTtmError',
    'incomeStatementError', 'balanceSheetError', 'cashFlowError',
    'discountedCashFlowError',
  ]
  const errors = errorFields.map((f) => payload[f]).filter(Boolean) as string[]
  return errors.length >= 3 && errors.some((e) => /limit\s*reach/i.test(e))
}

export function FundamentalsView({ symbol, onBackToScreener }: FundamentalsViewProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [payload, setPayload] = useState<FmpFundamentalsPayload | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      setPayload(null)

      try {
        const endpoint = apiEndpoint('/api/fmp/fundamentals')
        endpoint.searchParams.set('symbol', symbol)
        const response = await fetch(endpoint)
        const body = await response.json()

        if (cancelled) {
          return
        }

        if (!response.ok) {
          setError(body.error ?? 'Could not load fundamentals.')
          return
        }

        setPayload(body)
      } catch {
        if (!cancelled) {
          setError('Could not connect to the API. Is the backend running?')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [symbol])

  const rateLimited = isRateLimited(payload)

  const profile = payload?.profile
  const km = payload?.keyMetricsTtm
  const ratios = payload?.ratiosTtm
  const dcf = payload?.discountedCashFlow
  const income = payload?.incomeStatementAnnual ?? []

  const dcfValue = dcf?.dcf
  const stockPriceFromDcf = dcf?.['Stock Price'] ?? dcf?.stockPrice

  const pe =
    km?.peRatio ??
    km?.peRatioTTM ??
    ratios?.priceToEarningsRatioTTM ??
    ratios?.priceEarningsRatioTTM
  const pb =
    km?.pbRatio ??
    km?.ptbRatio ??
    km?.priceToBookRatioTTM ??
    ratios?.priceToBookRatioTTM
  const roe = km?.roeTTM ?? km?.roe ?? km?.returnOnEquityTTM
  const roic = km?.roicTTM ?? km?.roic ?? km?.returnOnInvestedCapitalTTM
  const evToEbitda =
    km?.enterpriseValueOverEBITDATTM ??
    km?.evToEBITDATTM ??
    ratios?.enterpriseValueMultipleTTM
  const debtEquity =
    km?.debtToEquity ??
    km?.debtToEquityTTM ??
    ratios?.debtToEquityRatioTTM
  const divYield =
    km?.dividendYieldTTM ??
    km?.dividendYield ??
    km?.dividendYieldPercentage ??
    ratios?.dividendYieldTTM
  const fcfYield =
    km?.freeCashFlowYieldTTM ??
    km?.freeCashFlowYield ??
    km?.fcfYieldTTM ??
    (ratios?.priceToFreeCashFlowRatioTTM
      ? 1 / Number(ratios.priceToFreeCashFlowRatioTTM)
      : null)

  return (
    <div className="fundamentals-page">
      <div className="fundamentals-toolbar">
        <button type="button" className="btn btn-secondary" onClick={onBackToScreener}>
          ← Back to screener
        </button>
        <a
          className="fundamentals-doc-link"
          href="https://financialmodelingprep.com/developer/docs"
          target="_blank"
          rel="noreferrer noopener"
        >
          FMP API docs
        </a>
      </div>

      <section className="panel fundamentals-hero">
        <div className="fundamentals-hero-main">
          <h2 className="fundamentals-title">
            {profile?.companyName ? cleanCompanyName(str(profile.companyName)) : symbol}{' '}
            <span className="fundamentals-symbol">{symbol}</span>
          </h2>
          <p className="fundamentals-subtitle">
            {str(profile?.exchangeShortName || profile?.exchange, '—')}
            {profile?.sector ? ` · ${str(profile.sector)}` : ''}
            {profile?.industry ? ` · ${str(profile.industry)}` : ''}
          </p>
        </div>
        <div className="fundamentals-meta">
          {payload?.cache ? (
            <span className="source-badge" title="Server-side cache reduces duplicate FMP calls">
              Cache: {str(payload.cache)}
            </span>
          ) : null}
          {payload?.dataSource ? (
            <span className="source-badge">Data: {str(payload.dataSource)}</span>
          ) : null}
        </div>
      </section>

      <section className="panel fundamentals-chart-panel">
        <div className="panel-header">
          <span className="panel-title">Live chart</span>
        </div>
        <div className="fundamentals-chart-wrap">
          <TradingViewChart symbol={symbol} />
        </div>
      </section>

      {loading ? <p className="status loading">Loading Financial Modeling Prep data…</p> : null}
      {error ? <p className="status error">{error}</p> : null}

      {rateLimited ? (
        <div className="status warning fundamentals-limit-banner">
          <strong>FMP API limit reached.</strong> The free tier daily quota has been exhausted.
          Fundamentals data will be available again tomorrow, or you can{' '}
          <a href="https://site.financialmodelingprep.com/" target="_blank" rel="noreferrer noopener">
            upgrade your FMP plan
          </a>.
          The live chart above still works independently.
        </div>
      ) : null}

      {!loading && !error && payload && !rateLimited ? (
        <>
          {payload.profileError ? (
            <p className="status warning">Profile: {str(payload.profileError)}</p>
          ) : null}

          <div className="fundamentals-grid">
            <section className="panel fundamentals-card">
              <div className="panel-header">
                <span className="panel-title">Quote & size</span>
              </div>
              <dl className="fundamentals-dl">
                {pickDefinedRow('Price', profile?.price != null ? `$${formatRatio(profile.price, 2)}` : null)}
                {pickDefinedRow(
                  'Market cap',
                  profile?.mktCap != null ? formatCompactNumber(profile.mktCap) : null
                )}
                {pickDefinedRow('Beta', profile?.beta != null ? formatRatio(profile.beta, 2) : null)}
                {pickDefinedRow(
                  '52W range',
                  profile?.range
                    ? String(profile.range)
                    : profile?.yearHigh != null && profile?.yearLow != null
                      ? `$${formatRatio(profile.yearLow, 2)} – $${formatRatio(profile.yearHigh, 2)}`
                      : null
                )}
                {pickDefinedRow(
                  'Volume (avg)',
                  profile?.volAvg != null ? formatCompactNumber(profile.volAvg) : null
                )}
              </dl>
            </section>

            <section className="panel fundamentals-card">
              <div className="panel-header">
                <span className="panel-title">DCF snapshot</span>
              </div>
              {payload.discountedCashFlowError ? (
                <p className="status warning">{str(payload.discountedCashFlowError)}</p>
              ) : (
                <dl className="fundamentals-dl">
                  {pickDefinedRow(
                    'DCF value',
                    dcfValue != null ? `$${formatRatio(dcfValue, 2)}` : null
                  )}
                  {pickDefinedRow(
                    'Last price (FMP)',
                    stockPriceFromDcf != null ? `$${formatRatio(stockPriceFromDcf, 2)}` : null
                  )}
                  {dcfValue != null &&
                  stockPriceFromDcf != null &&
                  Number(stockPriceFromDcf) !== 0 ? (
                    <div className="fundamentals-dl-row">
                      <dt>vs DCF</dt>
                      <dd>
                        {(
                          ((Number(stockPriceFromDcf) - Number(dcfValue)) / Number(dcfValue)) *
                          100
                        ).toFixed(1)}
                        % (price relative to DCF)
                      </dd>
                    </div>
                  ) : null}
                </dl>
              )}
              <p className="fundamentals-footnote">
                DCF is a model output, not a buy/sell signal. Use it with other checks.
              </p>
            </section>

            <section className="panel fundamentals-card fundamentals-card-wide">
              <div className="panel-header">
                <span className="panel-title">Key metrics (TTM)</span>
              </div>
              {payload.keyMetricsTtmError ? (
                <p className="status warning">{str(payload.keyMetricsTtmError)}</p>
              ) : (
                <dl className="fundamentals-dl fundamentals-dl-3col">
                  {pickDefinedRow('P/E', pe != null ? formatRatio(pe, 2) : null)}
                  {pickDefinedRow('P/B', pb != null ? formatRatio(pb, 2) : null)}
                  {pickDefinedRow(
                    'EV / EBITDA',
                    evToEbitda != null ? formatRatio(evToEbitda, 2) : null
                  )}
                  {pickDefinedRow('ROE', roe != null ? formatPctFlexible(roe) : null)}
                  {pickDefinedRow('ROIC', roic != null ? formatPctFlexible(roic) : null)}
                  {pickDefinedRow(
                    'Debt / equity',
                    debtEquity != null ? formatRatio(debtEquity, 2) : null
                  )}
                  {pickDefinedRow(
                    'Dividend yield',
                    divYield != null ? formatPctFlexible(divYield) : null
                  )}
                  {pickDefinedRow(
                    'FCF yield',
                    fcfYield != null ? formatPctFlexible(fcfYield) : null
                  )}
                </dl>
              )}
            </section>

            <section className="panel fundamentals-card fundamentals-card-wide">
              <div className="panel-header">
                <span className="panel-title">Ratios (TTM)</span>
              </div>
              {payload.ratiosTtmError ? (
                <p className="status warning">{str(payload.ratiosTtmError)}</p>
              ) : (
                <dl className="fundamentals-dl fundamentals-dl-3col">
                  {pickDefinedRow(
                    'Gross margin',
                    (() => {
                      const v =
                        ratios?.grossProfitMarginTTM ?? ratios?.grossProfitMargin
                      return v != null ? formatPctFlexible(v) : null
                    })()
                  )}
                  {pickDefinedRow(
                    'Operating margin',
                    (() => {
                      const v =
                        ratios?.operatingProfitMarginTTM ?? ratios?.operatingProfitMargin
                      return v != null ? formatPctFlexible(v) : null
                    })()
                  )}
                  {pickDefinedRow(
                    'Net margin',
                    (() => {
                      const v = ratios?.netProfitMarginTTM ?? ratios?.netProfitMargin
                      return v != null ? formatPctFlexible(v) : null
                    })()
                  )}
                  {pickDefinedRow(
                    'Current ratio',
                    (() => {
                      const v = ratios?.currentRatioTTM ?? km?.currentRatioTTM
                      return v != null ? formatRatio(v, 2) : null
                    })()
                  )}
                  {pickDefinedRow(
                    'Interest coverage',
                    (() => {
                      const v =
                        ratios?.interestCoverageTTM ?? ratios?.interestCoverageRatioTTM
                      return v != null ? formatRatio(v, 2) : null
                    })()
                  )}
                  {pickDefinedRow(
                    'Asset turnover',
                    ratios?.assetTurnoverTTM != null ? formatRatio(ratios.assetTurnoverTTM, 2) : null
                  )}
                </dl>
              )}
            </section>
          </div>

          <section className="panel fundamentals-table-panel">
            <div className="panel-header">
              <span className="panel-title">Income statement (annual, recent)</span>
            </div>
            {payload.incomeStatementError ? (
              <p className="status warning">{str(payload.incomeStatementError)}</p>
            ) : income.length ? (
              <div className="fundamentals-table-wrap">
                <table className="fundamentals-table">
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th>Revenue</th>
                      <th>Net income</th>
                      <th>EPS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {income.slice(0, 5).map((row, index) => (
                      <tr key={String(row.calendarYear ?? row.date ?? row.fillingDate ?? index)}>
                        <td>{str(row.calendarYear, '—')}</td>
                        <td>{row.revenue != null ? formatCompactNumber(row.revenue) : '—'}</td>
                        <td>{row.netIncome != null ? formatCompactNumber(row.netIncome) : '—'}</td>
                        <td>{row.eps != null ? formatRatio(row.eps, 2) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="status warning">No annual income statement rows returned.</p>
            )}
          </section>

          {(payload.balanceSheetError || payload.cashFlowError) && (
            <p className="status warning">
              {payload.balanceSheetError ? `Balance sheet: ${payload.balanceSheetError} ` : ''}
              {payload.cashFlowError ? `Cash flow: ${payload.cashFlowError}` : ''}
            </p>
          )}

          <p className="fundamentals-api-note">
            This view issues several FMP requests per load; the server caches results for one hour.
            Add your own scoring logic on top of this payload next.
          </p>
        </>
      ) : null}
    </div>
  )
}
