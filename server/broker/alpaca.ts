import { fetchWithTimeout } from '../lib/http.js'
import { ALPACA_CONFIG } from './config.js'
import type { AccountSnapshot, BrokerOrderId, BrokerStatus, ExecutionFill, OpenOrderRow } from './types.js'
import type { BracketProposal } from './proposal.js'
import { toTickerSymbol } from './symbols.js'

export type { AccountSnapshot, BrokerStatus, ExecutionFill }

const recentErrors: BrokerStatus['recentErrors'] = []

function headers(): Record<string, string> {
  return {
    Accept: 'application/json',
    'APCA-API-KEY-ID': ALPACA_CONFIG.apiKeyId,
    'APCA-API-SECRET-KEY': ALPACA_CONFIG.apiSecretKey,
  }
}

async function alpacaFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${ALPACA_CONFIG.baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  const response = await fetchWithTimeout(url, { ...init, headers: { ...headers(), ...init.headers } }, 20000)
  const text = await response.text()
  let payload: any = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = null
  }
  if (!response.ok) {
    const message =
      payload?.message ?? payload?.error ?? (text ? text.slice(0, 220) : `Alpaca HTTP ${response.status}`)
    recentErrors.unshift({
      at: new Date().toISOString(),
      reqId: null,
      code: response.status,
      message: String(message),
      informational: false,
    })
    recentErrors.length = Math.min(recentErrors.length, 10)
    throw new Error(String(message))
  }
  return payload as T
}

function fmtPrice(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2)
}

export function connectBroker(): void {
  /* REST — no persistent socket */
}

export async function getBrokerStatus(): Promise<BrokerStatus> {
  const base = {
    account: null,
    paper: ALPACA_CONFIG.paper,
    tradingAllowed: false,
    recentErrors,
    provider: 'alpaca' as const,
  }
  if (!ALPACA_CONFIG.apiKeyId || !ALPACA_CONFIG.apiSecretKey) {
    return {
      ...base,
      connected: false,
      reason: 'Configurá ALPACA_API_KEY_ID y ALPACA_API_SECRET_KEY (paper) en .env.',
    }
  }
  try {
    const acct = await alpacaFetch<{
      id: string
      account_number: string
      status: string
    }>('/v2/account')
    const tradingAllowed = ALPACA_CONFIG.paper || ALPACA_CONFIG.allowLive
    return {
      ...base,
      connected: acct.status === 'ACTIVE',
      account: acct.account_number || acct.id,
      paper: ALPACA_CONFIG.paper,
      tradingAllowed,
      reason: tradingAllowed ? null : 'Alpaca live bloqueado. Usá ALPACA_PAPER=true o ALPACA_ALLOW_LIVE=true.',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error Alpaca'
    return { ...base, connected: false, reason: message }
  }
}

async function requireTrading(): Promise<string> {
  const status = await getBrokerStatus()
  if (!status.connected || !status.tradingAllowed || !status.account) {
    throw new Error(status.reason ?? 'Cuenta Alpaca no habilitada.')
  }
  return status.account
}

export async function getAccountSnapshot(): Promise<AccountSnapshot> {
  const account = await requireTrading()
  const acct = await alpacaFetch<{
    equity: string
    cash: string
    buying_power: string
  }>('/v2/account')
  const equity = Number(acct.equity)
  const cash = Number(acct.buying_power ?? acct.cash)
  return {
    account,
    netLiquidation: Number.isFinite(equity) ? equity : null,
    cash: Number.isFinite(cash) ? cash : null,
  }
}

export async function getPositions() {
  await requireTrading()
  const rows = await alpacaFetch<
    Array<{
      symbol: string
      qty: string
      avg_entry_price: string
      current_price: string
      unrealized_pl: string
    }>
  >('/v2/positions')
  return rows
    .map((position) => {
      const quantity = Number(position.qty)
      if (!(quantity > 0)) return null
      return {
        symbol: position.symbol,
        quantity,
        avgCost: Number(position.avg_entry_price) || null,
        marketPrice: Number(position.current_price) || null,
        unrealizedPnl: Number(position.unrealized_pl) || null,
      }
    })
    .filter(Boolean)
}

export async function getOpenOrders(): Promise<OpenOrderRow[]> {
  await requireTrading()
  const rows = await alpacaFetch<
    Array<{
      id: string
      symbol: string
      side: string
      type: string
      qty: string
      limit_price: string | null
      stop_price: string | null
      status: string
    }>
  >('/v2/orders?status=open&limit=500')
  return rows.map((order) => ({
    orderId: order.id,
    parentId: null,
    symbol: order.symbol,
    action: order.side.toUpperCase() === 'BUY' ? 'BUY' : 'SELL',
    orderType: order.type,
    quantity: Number(order.qty),
    limitPrice: order.limit_price != null ? Number(order.limit_price) : null,
    stopPrice: order.stop_price != null ? Number(order.stop_price) : null,
    status: order.status,
  }))
}

export async function getExecutionsSince(isoDate: string): Promise<ExecutionFill[]> {
  await requireTrading()
  const after = `${isoDate}T00:00:00Z`
  const activities = await alpacaFetch<
    Array<{
      id: string
      activity_type: string
      symbol: string
      side: string
      qty: string
      price: string
      transaction_time: string
    }>
  >(`/v2/account/activities/FILL?after=${encodeURIComponent(after)}&direction=asc`)
  return activities
    .filter((row) => row.activity_type === 'FILL' && row.symbol)
    .map((row) => {
      const sessionDate = row.transaction_time.slice(0, 10)
      const side = row.side?.toLowerCase() === 'buy' ? 'BUY' : 'SELL'
      return {
        execId: row.id,
        symbol: row.symbol,
        side,
        quantity: Number(row.qty),
        price: Number(row.price),
        time: row.transaction_time,
        sessionDate,
      } satisfies ExecutionFill
    })
    .filter((fill) => fill.quantity > 0 && fill.price > 0)
}

export async function placeBracketOrder(proposal: BracketProposal) {
  const account = await requireTrading()
  const payload = {
    symbol: toTickerSymbol(proposal.symbol),
    qty: String(proposal.quantity),
    side: 'buy',
    type: 'limit',
    time_in_force: 'day',
    limit_price: fmtPrice(proposal.entryPrice),
    order_class: 'bracket',
    take_profit: { limit_price: fmtPrice(proposal.takeProfit) },
    stop_loss: { stop_price: fmtPrice(proposal.stopLoss) },
  }
  const order = await alpacaFetch<{
    id: string
    legs?: Array<{ id: string }>
  }>('/v2/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const legs = order.legs ?? []
  return {
    account,
    parentOrderId: order.id as BrokerOrderId,
    takeProfitOrderId: (legs[0]?.id ?? order.id) as BrokerOrderId,
    stopLossOrderId: (legs[1]?.id ?? order.id) as BrokerOrderId,
  }
}

export async function modifyStopOrder(params: {
  orderId: BrokerOrderId
  parentId: BrokerOrderId | null
  symbol: string
  quantity: number
  stopPrice: number
}): Promise<void> {
  await requireTrading()
  await alpacaFetch(`/v2/orders/${params.orderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      qty: String(params.quantity),
      stop_price: fmtPrice(params.stopPrice),
    }),
  })
}

export async function placeProtectiveStop(params: {
  symbol: string
  quantity: number
  stopPrice: number
}): Promise<BrokerOrderId> {
  await requireTrading()
  const order = await alpacaFetch<{ id: string }>('/v2/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol: toTickerSymbol(params.symbol),
      qty: String(params.quantity),
      side: 'sell',
      type: 'stop',
      time_in_force: 'gtc',
      stop_price: fmtPrice(params.stopPrice),
    }),
  })
  return order.id
}

export async function placeMarketSell(params: { symbol: string; quantity: number }): Promise<BrokerOrderId> {
  await requireTrading()
  const order = await alpacaFetch<{ id: string }>('/v2/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol: toTickerSymbol(params.symbol),
      qty: String(params.quantity),
      side: 'sell',
      type: 'market',
      time_in_force: 'day',
    }),
  })
  return order.id
}

export async function cancelOrder(orderId: BrokerOrderId): Promise<void> {
  await requireTrading()
  await alpacaFetch(`/v2/orders/${orderId}`, { method: 'DELETE' })
}

export { toTickerSymbol } from './symbols.js'