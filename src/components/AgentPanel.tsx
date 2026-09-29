import { useCallback, useEffect, useState } from 'react'
import { apiEndpoint } from '../services/servicesAPI.ts'

interface AgentDecision {
  id: number
  at: string
  kind: string
  symbol: string | null
  detail: string
}

interface AgentTrade {
  id: number
  symbol: string
  quantity: number
  entryPrice: number
  stopLoss: number
  takeProfit: number
  reason: string | null
  openedAt: string
}

interface AgentStatus {
  enabled: boolean
  running?: boolean
  busy?: boolean
  paperOnly?: boolean
  intervalMs?: number
  lastCycle?: { at: string; status: string; summary: string } | null
  broker?: {
    connected?: boolean
    account?: string | null
    paper?: boolean
    tradingAllowed?: boolean
    reason?: string | null
  }
  limits?: { maxOrderUsd: number; maxOrdersPerDay: number; confirmedToday: number }
  config?: {
    maxPositions: number
    riskPct: number
    maxOrderUsd: number
    maxOrdersPerDay: number
    aiVeto: boolean
    allowOutsideHours: boolean
  }
  decisions?: AgentDecision[]
  trades?: AgentTrade[]
  error?: string
}

const usd = (value: number | null | undefined): string =>
  Number.isFinite(value) ? `$${Number(value).toFixed(2)}` : '—'

async function agentRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiEndpoint(path), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(body.error ?? `Error ${response.status}`)
  }
  return body as T
}

function kindLabel(kind: string): string {
  if (kind === 'buy') return 'Compra'
  if (kind === 'veto') return 'Veto IA'
  if (kind === 'trail') return 'Trailing'
  if (kind === 'breakeven') return 'Break-even'
  if (kind === 'protect') return 'Stop protector'
  if (kind === 'reject' || kind === 'skip') return 'Omitido'
  if (kind === 'error') return 'Error'
  return 'Scan'
}

/** Paper-only IBKR loop: pick screener names, send brackets, trail stops. */
export function AgentPanel() {
  const [status, setStatus] = useState<AgentStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setStatus(await agentRequest<AgentStatus>('/api/agent/status'))
    } catch {
      setStatus({ enabled: false })
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 12_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  async function run(path: string) {
    setBusy(true)
    setError('')
    try {
      setStatus(await agentRequest<AgentStatus>(path, { method: 'POST' }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado.')
    } finally {
      setBusy(false)
    }
  }

  if (!status) {
    return <p className="status loading">Consultando el agente paper…</p>
  }

  if (!status.enabled) {
    return (
      <div className="agent-panel">
        <h2>Agente paper IBKR</h2>
        <p className="subtitle">
          Para activarlo en esta máquina: IB Gateway abierto en paper, <code>IBKR_ENABLED=true</code> y{' '}
          <code>AGENT_ENABLED=true</code> en el <code>.env</code> local. Nunca lo habilites en Render.
        </p>
      </div>
    )
  }

  const { broker, config, limits, lastCycle } = status
  const canTrade = Boolean(broker?.paper && broker.tradingAllowed)

  return (
    <div className="agent-panel">
      <h2>Agente paper IBKR</h2>
      <p className="subtitle">
        Elige nombres del screener (breakout, pullback, reversal, momentum), manda un bracket con stop y
        take-profit, y sube el stop a break-even / trailing. Solo cuenta paper. Las reglas ponen precio y
        tamaño; la IA como mucho veta.
      </p>

      <p className={broker?.paper ? 'status loading' : 'status warning'}>
        {broker?.account ? `${broker.account} · ${broker.paper ? 'PAPER' : 'REAL'}` : 'Sin cuenta'}
        {status.running ? ' · en marcha' : ' · detenido'}
        {broker?.reason ? ` · ${broker.reason}` : ''}
      </p>

      {config ? (
        <p className="fundamentals-footnote">
          Riesgo {config.riskPct}% del equity por trade · máx. US${config.maxOrderUsd} ·{' '}
          {config.maxPositions} posiciones · {limits?.confirmedToday ?? 0}/{config.maxOrdersPerDay} órdenes hoy
          · ciclo cada {Math.round((status.intervalMs ?? 0) / 60000)} min
          {config.aiVeto ? ' · veto IA' : ''}.
        </p>
      ) : null}

      <div className="input-row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !canTrade || status.running}
          onClick={() => void run('/api/agent/start')}
        >
          Encender
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || !status.running}
          onClick={() => void run('/api/agent/stop')}
        >
          Apagar
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || !canTrade}
          onClick={() => void run('/api/agent/run')}
        >
          Probar ahora
        </button>
      </div>

      {error ? <p className="status error">{error}</p> : null}

      {lastCycle ? (
        <p className={lastCycle.status === 'error' ? 'status error' : 'status loading'}>
          Último ciclo ({new Date(lastCycle.at).toLocaleTimeString()}): {lastCycle.summary}
        </p>
      ) : null}

      {status.trades?.length ? (
        <>
          <h3 className="technical-subheading">Trades del agente</h3>
          <ul className="technical-list">
            {status.trades.map((trade) => (
              <li key={trade.id}>
                <strong>{trade.symbol}</strong> {trade.quantity} × {usd(trade.entryPrice)} · stop{' '}
                <span className="negative">{usd(trade.stopLoss)}</span> · TP{' '}
                <span className="positive">{usd(trade.takeProfit)}</span>
                {trade.reason ? ` · ${trade.reason}` : ''}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {status.decisions?.length ? (
        <>
          <h3 className="technical-subheading">Decisiones recientes</h3>
          <ul className="technical-list agent-decision-list">
            {status.decisions.map((item) => (
              <li key={item.id} className={item.kind === 'error' ? 'negative' : undefined}>
                <span className="agent-decision-kind">{kindLabel(item.kind)}</span>
                {item.symbol ? ` ${item.symbol} · ` : ' '}
                {item.detail}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="fundamentals-footnote">Todavía no hay decisiones. Encendé el agente o usá “Probar ahora”.</p>
      )}
    </div>
  )
}
