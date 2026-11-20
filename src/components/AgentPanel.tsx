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
    sizingMode?: string
    cashDeployPct?: number
    maxOrderUsd: number
    maxOrdersPerDay: number
    aiVeto: boolean
    allowOutsideHours: boolean
    dailyProfitUsd: number
    dailyLossUsd: number
    weeklyProfitUsd: number
    weeklyLossUsd: number
    reportEmail: string | null
    allowLive?: boolean
  }
  day?: { sessionDate: string; pnl: number | null; halt: 'profit' | 'loss' | null }
  week?: { weekStart: string; pnl: number | null; halt: 'profit' | 'loss' | null }
  decisions?: AgentDecision[]
  trades?: AgentTrade[]
  error?: string
  sent?: boolean
  reason?: string
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
  if (kind === 'rotate') return 'Rotación'
  if (kind === 'reject' || kind === 'skip') return 'Omitido'
  if (kind === 'error') return 'Error'
  return 'Scan'
}

/** IBKR agent loop: screener entries, brackets, trailing stops (paper by default; live with env flags). */
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
    return <p className="status loading">Consultando el agente IBKR…</p>
  }

  if (!status.enabled) {
    return (
      <div className="agent-panel">
        <h2>Agente IBKR</h2>
        <p className="subtitle">
          Para activarlo en esta máquina: IB Gateway abierto (paper 4002 o live 4001),{' '}
          <code>IBKR_ENABLED=true</code> y <code>AGENT_ENABLED=true</code> en el <code>.env</code> local. En cuenta
          real también <code>IBKR_ALLOW_LIVE=true</code> y <code>AGENT_ALLOW_LIVE=true</code>. Nunca en Render.
        </p>
      </div>
    )
  }

  const { broker, config, limits, lastCycle } = status
  const isPaper = Boolean(broker?.paper)
  const canTrade = Boolean(
    broker?.tradingAllowed && (broker?.paper || config?.allowLive)
  )

  return (
    <div className="agent-panel">
      <h2>{isPaper ? 'Agente IBKR (paper)' : 'Agente IBKR (cuenta real)'}</h2>
      <p className="subtitle">
        Elige nombres del screener (breakout, pullback, reversal, momentum), manda un bracket con stop y
        take-profit, y sube el stop a break-even / trailing. Las reglas fijan precio y tamaño; la IA solo veta
        entradas.
        {isPaper
          ? ' Modo paper (DU/DF): sin dinero real.'
          : ' Modo real: cada orden usa tu saldo en IBKR.'}
      </p>

      <p className={broker?.paper ? 'status loading' : 'status warning'}>
        {broker?.account ? `${broker.account} · ${broker.paper ? 'PAPER' : 'REAL'}` : 'Sin cuenta'}
        {status.running ? ' · en marcha' : ' · detenido'}
        {broker?.reason ? ` · ${broker.reason}` : ''}
      </p>

      {!isPaper ? (
        <p className="status warning">
          Metas día +US${config?.dailyProfitUsd ?? '—'} / −US${config?.dailyLossUsd ?? '—'} y semana +US$
          {config?.weeklyProfitUsd ?? '—'} / −US${config?.weeklyLossUsd ?? '—'}: solo frenan nuevas compras; no
          cierran posiciones ni garantizan ganancias.
        </p>
      ) : null}

      {!canTrade && broker?.connected ? (
        <p className="status warning">
          {isPaper
            ? 'Operación bloqueada: revisá permisos de API en Gateway (Read-Only desactivado).'
            : 'Operación bloqueada: faltan IBKR_ALLOW_LIVE y AGENT_ALLOW_LIVE en .env, o la API está en solo lectura.'}
        </p>
      ) : null}

      {config ? (
        <p className="fundamentals-footnote">
          {config.sizingMode === 'cash'
            ? `Tamaño por cash (~${config.cashDeployPct ?? 85}% del efectivo / cupo libre)`
            : `Riesgo ${config.riskPct}% del equity por trade`}{' '}
          · máx. US${config.maxOrderUsd} ·{' '}
          {config.maxPositions} posiciones · {limits?.confirmedToday ?? 0}/{config.maxOrdersPerDay} órdenes hoy
          · ciclo cada {Math.round((status.intervalMs ?? 0) / 60000)} min
          {config.aiVeto ? ' · veto IA' : ''}. Meta día +US${config.dailyProfitUsd} / −US$
          {config.dailyLossUsd} · semana +US${config.weeklyProfitUsd} / −US${config.weeklyLossUsd} (deja de
          comprar; no liquida). Mail a {config.reportEmail ?? 'AGENT_REPORT_EMAIL (faltante)'}.
        </p>
      ) : null}

      {status.day ? (
        <p className={status.day.halt === 'loss' ? 'status warning' : 'status loading'}>
          P&L sesión {status.day.sessionDate}: {usd(status.day.pnl)}
          {status.day.halt === 'profit' ? ' · meta diaria alcanzada' : ''}
          {status.day.halt === 'loss' ? ' · stop diario activo' : ''}
        </p>
      ) : null}

      {status.week ? (
        <p className={status.week.halt === 'loss' ? 'status warning' : 'status loading'}>
          P&L semana (desde {status.week.weekStart} NY): {usd(status.week.pnl)}
          {status.week.halt === 'profit' ? ' · meta semanal alcanzada' : ''}
          {status.week.halt === 'loss' ? ' · stop semanal activo' : ''}
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
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || !canTrade}
          onClick={() => void run('/api/agent/report')}
        >
          Enviar reporte
        </button>
      </div>

      {error ? <p className="status error">{error}</p> : null}
      {status.reason && status.sent === false ? <p className="status warning">{status.reason}</p> : null}
      {status.reason && status.sent ? <p className="status loading">{status.reason}</p> : null}

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
