import { useCallback, useEffect, useState } from 'react'
import { apiEndpoint } from '../services/servicesAPI.ts'

interface BrokerStatus {
  enabled: boolean
  connected?: boolean
  account?: string | null
  paper?: boolean
  tradingAllowed?: boolean
  reason?: string | null
  limits?: { maxOrderUsd: number; maxOrdersPerDay: number; confirmedToday: number }
  recentErrors?: Array<{ at: string; reqId: number | null; message: string }>
}

interface Proposal {
  id: string
  symbol: string
  quantity: number
  entryPrice: number
  stopLoss: number
  takeProfit: number
  notionalUsd: number
  riskUsd: number
  stopSource: 'support' | 'percent'
  priceAsOf: string
  expiresAt: number
}

interface OpenOrder {
  orderId: number
  parentId: number | null
  symbol: string
  action: string
  orderType: string
  quantity: number
  limitPrice: number | null
  stopPrice: number | null
  status: string | null
}

interface PlacedOrder {
  parentOrderId: number
  takeProfitOrderId: number
  stopLossOrderId: number
}

const usd = (value: number | null | undefined): string =>
  Number.isFinite(value) ? `$${Number(value).toFixed(2)}` : '—'

async function brokerRequest<T>(path: string, init?: RequestInit): Promise<T> {
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

/** Proposes an IB bracket order for `symbol` and only sends it after explicit confirmation. */
export function BrokerOrderPanel({ symbol }: { symbol: string }) {
  const [status, setStatus] = useState<BrokerStatus | null>(null)
  const [budget, setBudget] = useState('500')
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [placed, setPlaced] = useState<PlacedOrder | null>(null)
  const [orders, setOrders] = useState<OpenOrder[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const next = await brokerRequest<BrokerStatus>('/api/broker/status')
      setStatus(next)
      if (next.tradingAllowed) {
        const { data } = await brokerRequest<{ data: OpenOrder[] }>('/api/broker/orders')
        setOrders(data.filter((order) => order.symbol === symbol.toUpperCase().replace('.', ' ')))
      }
    } catch {
      setStatus({ enabled: false })
    }
  }, [symbol])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!status?.enabled) return null

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado.')
    } finally {
      setBusy(false)
    }
  }

  const propose = () =>
    run(async () => {
      setPlaced(null)
      setProposal(
        await brokerRequest<Proposal>('/api/broker/proposals', {
          method: 'POST',
          body: JSON.stringify({ symbol, budgetUsd: Number(budget) }),
        })
      )
    })

  const confirm = () =>
    run(async () => {
      if (!proposal) return
      const result = await brokerRequest<PlacedOrder>(`/api/broker/proposals/${proposal.id}/confirm`, {
        method: 'POST',
      })
      setProposal(null)
      setPlaced(result)
      await refresh()
    })

  const cancel = (orderId: number) =>
    run(async () => {
      await brokerRequest(`/api/broker/orders/${orderId}`, { method: 'DELETE' })
      await refresh()
    })

  const { limits } = status

  return (
    <section className="panel technical-narrative-panel">
      <div className="panel-header">
        <span className="panel-title">Operar en Interactive Brokers</span>
        <span className="source-badge">
          {status.account ? `${status.account} · ${status.paper ? 'PAPER' : 'REAL'}` : 'Sin cuenta'}
        </span>
      </div>

      {status.reason ? <p className="status warning">{status.reason}</p> : null}

      {status.tradingAllowed ? (
        <>
          <div className="input-row">
            <input
              className="input-field"
              type="number"
              min={1}
              max={limits?.maxOrderUsd}
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
              aria-label="Presupuesto en USD"
            />
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={propose}>
              Proponer orden
            </button>
          </div>
          {limits ? (
            <p className="fundamentals-footnote">
              Máximo US${limits.maxOrderUsd} por orden · {limits.confirmedToday}/{limits.maxOrdersPerDay} órdenes hoy.
            </p>
          ) : null}
        </>
      ) : null}

      {error ? <p className="status error">{error}</p> : null}

      {proposal ? (
        <>
          <dl className="fundamentals-dl fundamentals-dl-3col">
            <div className="fundamentals-dl-row">
              <dt>Compra (límite)</dt>
              <dd>
                {proposal.quantity} × {usd(proposal.entryPrice)}
              </dd>
            </div>
            <div className="fundamentals-dl-row">
              <dt>Stop-loss</dt>
              <dd className="negative">
                {usd(proposal.stopLoss)} {proposal.stopSource === 'support' ? '(bajo soporte)' : '(% fijo)'}
              </dd>
            </div>
            <div className="fundamentals-dl-row">
              <dt>Take-profit</dt>
              <dd className="positive">{usd(proposal.takeProfit)}</dd>
            </div>
            <div className="fundamentals-dl-row">
              <dt>Total</dt>
              <dd>{usd(proposal.notionalUsd)}</dd>
            </div>
            <div className="fundamentals-dl-row">
              <dt>Pérdida máxima si toca el stop</dt>
              <dd className="negative">{usd(proposal.riskUsd)}</dd>
            </div>
            <div className="fundamentals-dl-row">
              <dt>Precio de referencia</dt>
              <dd>Cierre del {proposal.priceAsOf}</dd>
            </div>
          </dl>
          <div className="input-row">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={confirm}>
              Confirmar y enviar a IB
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setProposal(null)}>
              Descartar
            </button>
          </div>
          <p className="fundamentals-footnote">
            La propuesta vence a las {new Date(proposal.expiresAt).toLocaleTimeString()}. La compra es límite y
            vence al cierre del día si no se ejecuta.
          </p>
        </>
      ) : null}

      {placed ? (
        <p className="status loading">
          Orden enviada: compra #{placed.parentOrderId}, take-profit #{placed.takeProfitOrderId}, stop-loss #
          {placed.stopLossOrderId}. Revisá el estado en IB Gateway.
        </p>
      ) : null}

      {orders.length ? (
        <>
          <h4 className="technical-subheading">Órdenes abiertas de {symbol}</h4>
          <ul className="technical-list">
            {orders.map((order) => (
              <li key={order.orderId}>
                #{order.orderId} {order.action} {order.quantity} {order.orderType}{' '}
                {usd(order.orderType === 'STP' ? order.stopPrice : order.limitPrice)} · {order.status ?? '—'}
                {order.parentId == null ? ' (cancela también su stop y take-profit) ' : ' '}
                <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => cancel(order.orderId)}>
                  Cancelar
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {status.recentErrors?.length ? (
        <>
          <h4 className="technical-subheading">Últimos mensajes de IB</h4>
          <ul className="technical-list technical-list-risk">
            {status.recentErrors.slice(0, 3).map((item) => (
              <li key={`${item.at}-${item.reqId}`}>
                {item.reqId != null ? `#${item.reqId}: ` : ''}
                {item.message}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}
