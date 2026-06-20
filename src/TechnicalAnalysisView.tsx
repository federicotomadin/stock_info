import { useEffect, useState } from 'react'
import { apiEndpoint } from './servicesAPI'

interface TechnicalAnalysisViewProps {
  symbol: string
  onBackToScreener: () => void
}

interface TechnicalAnalysisPayload {
  [key: string]: unknown
  indicators?: Record<string, unknown>
  analysis?: Record<string, unknown>
  ai?: Record<string, unknown>
}

function str(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return fallback
  return String(value)
}

function formatNumber(value: unknown, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return 'N/A'
  }
  return Number(value).toFixed(digits)
}

function formatPercent(value: unknown, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return 'N/A'
  }
  return `${Number(value).toFixed(digits)}%`
}

function formatPrice(value: unknown): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return 'N/A'
  }
  return `$${Number(value).toFixed(2)}`
}

function trendBadgeClass(trend: unknown): string {
  if (trend === 'uptrend') return 'trend-chip positive'
  if (trend === 'downtrend') return 'trend-chip negative'
  return 'trend-chip neutral'
}

function trendLabel(trend: unknown): string {
  if (trend === 'uptrend') return 'Alcista'
  if (trend === 'downtrend') return 'Bajista'
  if (trend === 'sideways') return 'Lateral'
  return '—'
}

function strengthLabel(strength: unknown): string {
  if (strength === 'strong') return 'Fuerte'
  if (strength === 'moderate') return 'Moderada'
  if (strength === 'weak') return 'Débil'
  return '—'
}

function rsiLabel(reading: unknown): string {
  if (reading === 'oversold') return 'Sobrevendido'
  if (reading === 'overbought') return 'Sobrecomprado'
  if (reading === 'neutral') return 'Neutral'
  return '—'
}

function momentumLabel(value: unknown): string {
  if (value === 'bullish') return 'Alcista'
  if (value === 'bearish') return 'Bajista'
  if (value === 'neutral') return 'Neutral'
  return '—'
}

function rsiClass(rsiValue: unknown): string {
  if (!Number.isFinite(Number(rsiValue))) return ''
  const n = Number(rsiValue)
  if (n >= 70) return 'negative'
  if (n <= 30) return 'positive'
  return ''
}

export function TechnicalAnalysisView({ symbol, onBackToScreener }: TechnicalAnalysisViewProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [payload, setPayload] = useState<TechnicalAnalysisPayload | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      setPayload(null)

      try {
        const endpoint = apiEndpoint('/api/technical-analysis')
        endpoint.searchParams.set('symbol', symbol)
        const response = await fetch(endpoint)
        const body = await response.json()

        if (cancelled) {
          return
        }

        if (!response.ok) {
          setError(body.error ?? 'No se pudo cargar el análisis técnico.')
          return
        }

        setPayload(body)
      } catch {
        if (!cancelled) {
          setError('No se pudo conectar con la API. ¿Está corriendo el backend?')
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

  const indicators = payload?.indicators
  const analysis = payload?.analysis
  const ai = payload?.ai as Record<string, unknown> | undefined
  const resistances = Array.isArray(payload?.resistances)
    ? (payload.resistances as Array<{ level: number; touches?: number }>)
    : []
  const supports = Array.isArray(payload?.supports)
    ? (payload.supports as Array<{ level: number; touches?: number }>)
    : []
  const observations = Array.isArray(analysis?.keyObservations)
    ? (analysis.keyObservations as string[])
    : []
  const patterns = Array.isArray(analysis?.patterns) ? (analysis.patterns as string[]) : []
  const riskFlags = Array.isArray(analysis?.riskFlags) ? (analysis.riskFlags as string[]) : []

  return (
    <div className="fundamentals-page">
      <div className="fundamentals-toolbar">
        <button type="button" className="btn btn-secondary" onClick={onBackToScreener}>
          ← Volver al screener
        </button>
        <span className="fundamentals-doc-link" aria-hidden>
          Análisis técnico · {ai ? `${str(ai.provider)} · ${str(ai.model)}` : 'indicadores locales'}
        </span>
      </div>

      <section className="panel fundamentals-hero">
        <div className="fundamentals-hero-main">
          <h2 className="fundamentals-title">
            {symbol}{' '}
            <span className="fundamentals-symbol">Technical view</span>
          </h2>
          <p className="fundamentals-subtitle">
            {payload?.asOf ? `Última vela: ${str(payload.asOf)}` : 'Cargando datos…'}
            {payload?.currentPrice != null ? ` · ${formatPrice(payload.currentPrice)}` : ''}
          </p>
        </div>
        <div className="fundamentals-meta">
          {payload?.cache ? (
            <span className="source-badge" title="Cache server-side reduces AI calls">
              Cache: {str(payload.cache)}
            </span>
          ) : null}
          {payload?.dataSource ? (
            <span
              className="source-badge"
              title={
                payload.fmpFallbackReason
                  ? `FMP no disponible: ${str(payload.fmpFallbackReason)}. Se usó ${str(payload.dataSource)} como fallback.`
                  : `Datos OHLCV de ${str(payload.dataSource)}`
              }
            >
              Data: {str(payload.dataSource)}
            </span>
          ) : null}
          {ai?.imageUsed ? (
            <span
              className="source-badge source-badge-hybrid"
              title="El LLM analizó los datos OHLCV + el gráfico renderizado (híbrido vision)"
            >
              Híbrido · texto + imagen
            </span>
          ) : null}
          {analysis?.trend ? (
            <span className={trendBadgeClass(analysis.trend)}>
              {trendLabel(analysis.trend)}
              {analysis.trendStrength ? ` · ${strengthLabel(analysis.trendStrength)}` : ''}
            </span>
          ) : null}
        </div>
      </section>

      {loading ? (
        <p className="status loading">Calculando indicadores y pidiendo análisis…</p>
      ) : null}
      {error ? <p className="status error">{error}</p> : null}

      {!loading && !error && payload ? (
        <>
          <div className="fundamentals-grid">
            <section className="panel fundamentals-card">
              <div className="panel-header">
                <span className="panel-title">Indicadores</span>
              </div>
              <dl className="fundamentals-dl fundamentals-dl-3col">
                <div className="fundamentals-dl-row">
                  <dt>Precio</dt>
                  <dd>{formatPrice(payload.currentPrice)}</dd>
                </div>
                <div className="fundamentals-dl-row">
                  <dt>Cambio 1D</dt>
                  <dd>{formatPercent(indicators?.dayChange)}</dd>
                </div>
                <div className="fundamentals-dl-row">
                  <dt>Cambio 1M</dt>
                  <dd>{formatPercent(indicators?.monthChange)}</dd>
                </div>
                <div className="fundamentals-dl-row">
                  <dt>SMA 20</dt>
                  <dd>{formatPrice(indicators?.sma20)}</dd>
                </div>
                <div className="fundamentals-dl-row">
                  <dt>SMA 50</dt>
                  <dd>{formatPrice(indicators?.sma50)}</dd>
                </div>
                <div className="fundamentals-dl-row">
                  <dt>SMA 200</dt>
                  <dd>{formatPrice(indicators?.sma200)}</dd>
                </div>
                <div className="fundamentals-dl-row">
                  <dt>RSI 14</dt>
                  <dd className={rsiClass(indicators?.rsi14)}>
                    {formatNumber(indicators?.rsi14, 1)}
                    {analysis?.rsiReading ? ` · ${rsiLabel(analysis.rsiReading)}` : ''}
                  </dd>
                </div>
                <div className="fundamentals-dl-row">
                  <dt>Volumen 20d vs 60d</dt>
                  <dd>{formatPercent(indicators?.volumeTrendPct)}</dd>
                </div>
                {analysis?.momentum ? (
                  <div className="fundamentals-dl-row">
                    <dt>Momentum</dt>
                    <dd>{momentumLabel(analysis.momentum)}</dd>
                  </div>
                ) : null}
              </dl>
            </section>

            <section className="panel fundamentals-card">
              <div className="panel-header">
                <span className="panel-title">Niveles clave</span>
              </div>
              <div className="technical-levels">
                <div>
                  <h4 className="technical-levels-title">Resistencias</h4>
                  {resistances.length ? (
                    <ul className="technical-levels-list">
                      {resistances.map((r) => (
                        <li key={`res-${r.level}`}>
                          {formatPrice(r.level)}{' '}
                          <span className="technical-levels-touches">
                            · {r.touches} toque{r.touches === 1 ? '' : 's'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="technical-levels-empty">Sin resistencias claras detectadas.</p>
                  )}
                </div>
                <div>
                  <h4 className="technical-levels-title">Soportes</h4>
                  {supports.length ? (
                    <ul className="technical-levels-list">
                      {supports.map((s) => (
                        <li key={`sup-${s.level}`}>
                          {formatPrice(s.level)}{' '}
                          <span className="technical-levels-touches">
                            · {s.touches} toque{s.touches === 1 ? '' : 's'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="technical-levels-empty">Sin soportes claros detectados.</p>
                  )}
                </div>
              </div>
            </section>
          </div>

          <section className="panel technical-narrative-panel">
            <div className="panel-header">
              <span className="panel-title">Lectura técnica</span>
                  {ai ? (
                <span className="source-badge">
                  {str(ai.provider)} · {str(ai.model)}
                </span>
              ) : null}
            </div>
            {payload.analysisError ? (
              <p className="status warning">{str(payload.analysisError)}</p>
            ) : null}
            {payload.chartImageError && !ai?.imageUsed ? (
              <p className="status warning">
                Imagen no disponible: {str(payload.chartImageError)}. La narrativa usó solo los datos numéricos.
              </p>
            ) : null}
            {analysis?.narrative ? (
              <p className="technical-narrative">{str(analysis.narrative)}</p>
            ) : null}

            {observations.length ? (
              <>
                <h4 className="technical-subheading">Observaciones clave</h4>
                <ul className="technical-list">
                  {observations.map((obs, index) => (
                    <li key={`obs-${index}`}>{obs}</li>
                  ))}
                </ul>
              </>
            ) : null}

            {patterns.length ? (
              <>
                <h4 className="technical-subheading">Patrones detectados</h4>
                <ul className="technical-list">
                  {patterns.map((pattern, index) => (
                    <li key={`pat-${index}`}>{pattern}</li>
                  ))}
                </ul>
              </>
            ) : null}

            {riskFlags.length ? (
              <>
                <h4 className="technical-subheading">Señales de riesgo</h4>
                <ul className="technical-list technical-list-risk">
                  {riskFlags.map((flag, index) => (
                    <li key={`risk-${index}`}>{flag}</li>
                  ))}
                </ul>
              </>
            ) : null}

            <p className="fundamentals-footnote">
              {str(payload.disclaimer)}
            </p>
          </section>
        </>
      ) : null}
    </div>
  )
}
