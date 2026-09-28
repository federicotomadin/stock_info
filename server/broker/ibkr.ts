import {
  ConnectionState,
  IBApiNext,
  OrderAction,
  OrderType,
  SecType,
  TimeInForce,
  type Contract,
  type Order,
} from '@stoqey/ib'
import { filter, firstValueFrom, timeout } from 'rxjs'
import { IBKR_CONFIG } from './config.js'
import type { BracketProposal } from './proposal.js'

const REQUEST_TIMEOUT_MS = 8000
const REJECTION_WAIT_MS = 3000

// 399 and 2100+ are informational (e.g. "order held until market open"), not rejections.
const isOrderRejection = (code: number): boolean => code !== 399 && code < 2100
const MAX_RECENT_ERRORS = 10

let api: IBApiNext | null = null
let connectionState = ConnectionState.Disconnected
const recentErrors: Array<{
  at: string
  reqId: number | null
  code: number
  message: string
  informational: boolean
}> = []

function getApi(): IBApiNext {
  if (api) return api

  const client = new IBApiNext({
    host: IBKR_CONFIG.host,
    port: IBKR_CONFIG.port,
    reconnectInterval: 10_000,
  })
  api = client
  client.connectionState.subscribe((state) => {
    if (client === api) connectionState = state
  })
  client.error.subscribe((error) => {
    // Reconnect attempts fail every few seconds while Gateway is closed; status.reason covers that.
    if (client !== api || connectionState !== ConnectionState.Connected) return
    recentErrors.unshift({
      at: new Date().toISOString(),
      reqId: error.reqId >= 0 ? error.reqId : null,
      code: Number(error.code),
      message: (error.error?.message ?? error.message).replace(/<br>/g, ' '),
      informational: !isOrderRejection(Number(error.code)),
    })
    recentErrors.length = Math.min(recentErrors.length, MAX_RECENT_ERRORS)
  })
  client.connect(IBKR_CONFIG.clientId)
  return client
}

/**
 * @stoqey/ib answers each nextValidId to the oldest pending request, so one unanswered request
 * (e.g. sent while Gateway was Read-Only) starves every later one. A fresh socket drops the queue.
 */
function resetConnection(): void {
  const stale = api
  api = null
  connectionState = ConnectionState.Disconnected
  stale?.disconnect()
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`IB no respondió a tiempo (${label}).`)), REQUEST_TIMEOUT_MS)
    ),
  ])
}

// IB paper accounts are prefixed with "D" (DU individual, DF advisor).
const isPaperAccount = (account: string): boolean => account.startsWith('D')

// IB uses a space for share classes: BRK.B -> "BRK B".
const toIbSymbol = (symbol: string): string => symbol.toUpperCase().replace('.', ' ')

function stockContract(symbol: string): Contract {
  return { symbol: toIbSymbol(symbol), secType: SecType.STK, exchange: 'SMART', currency: 'USD' }
}

export interface BrokerStatus {
  connected: boolean
  account: string | null
  paper: boolean
  tradingAllowed: boolean
  reason: string | null
  recentErrors: typeof recentErrors
}

const CONNECT_WAIT_MS = 3000

/** Opens the Gateway socket at startup so the first status request doesn't report a false disconnect. */
export function connectBroker(): void {
  getApi()
}

async function waitForConnection(): Promise<void> {
  await firstValueFrom(
    getApi().connectionState.pipe(
      filter((state) => state === ConnectionState.Connected),
      timeout(CONNECT_WAIT_MS)
    )
  ).catch(() => undefined)
}

export async function getBrokerStatus(): Promise<BrokerStatus> {
  const client = getApi()
  const base = { account: null, paper: false, tradingAllowed: false, recentErrors }
  await waitForConnection()

  if (connectionState !== ConnectionState.Connected) {
    return {
      ...base,
      connected: false,
      reason: `Sin conexión a IB Gateway en ${IBKR_CONFIG.host}:${IBKR_CONFIG.port}. ¿Está abierto y logueado?`,
    }
  }

  const accounts = await withTimeout(client.getManagedAccounts(), 'cuentas')
  const account = IBKR_CONFIG.account || (accounts.length === 1 ? accounts[0] : '')

  if (!account || !accounts.includes(account)) {
    return {
      ...base,
      connected: true,
      reason: `Configurá IBKR_ACCOUNT con una de estas cuentas: ${accounts.join(', ')}.`,
    }
  }

  const paper = isPaperAccount(account)
  const tradingAllowed = paper || IBKR_CONFIG.allowLive
  return {
    ...base,
    connected: true,
    account,
    paper,
    tradingAllowed,
    reason: tradingAllowed ? null : 'Cuenta real bloqueada. Solo se opera en paper salvo IBKR_ALLOW_LIVE=true.',
  }
}

async function requireTradableAccount(): Promise<string> {
  const status = await getBrokerStatus()
  if (!status.tradingAllowed || !status.account) {
    throw new Error(status.reason ?? 'La cuenta de IB no está habilitada para operar.')
  }
  return status.account
}

export async function getPositions() {
  const account = await requireTradableAccount()
  const update = await firstValueFrom(getApi().getPositions().pipe(timeout(REQUEST_TIMEOUT_MS)))
  return (update.all.get(account) ?? [])
    .filter((position) => position.pos !== 0)
    .map((position) => ({
      symbol: position.contract.symbol,
      quantity: position.pos,
      avgCost: position.avgCost ?? null,
    }))
}

export async function getOpenOrders() {
  const account = await requireTradableAccount()
  // getOpenOrders() never emits when the account has no open orders; this one resolves to [].
  const orders = await withTimeout(getApi().getAllOpenOrders(), 'órdenes abiertas')
  return orders
    .filter(({ order }) => !order.account || order.account === account)
    .map(({ orderId, contract, order, orderState }) => ({
    orderId,
    parentId: order.parentId || null,
    symbol: contract.symbol,
    action: order.action,
    orderType: order.orderType,
    quantity: order.totalQuantity,
    limitPrice: order.lmtPrice ?? null,
    stopPrice: order.auxPrice ?? null,
    status: orderState?.status ?? null,
  }))
}

/**
 * Sends entry + take-profit + stop-loss as one IB bracket: only the last child transmits, so
 * IB activates all three atomically and keeps the stop server-side even if this app goes down.
 */
export async function placeBracketOrder(proposal: BracketProposal) {
  const account = await requireTradableAccount()
  const client = getApi()
  const contract = stockContract(proposal.symbol)
  const parentId = await withTimeout(client.getNextValidOrderId(), 'order id').catch(() => {
    resetConnection()
    throw new Error(
      'IB no devolvió un número de orden y se reinició la conexión: generá una propuesta nueva. ' +
        'Si se repite, revisá que "Read-Only API" esté destildado en Configure → Settings → API → Settings.'
    )
  })
  const takeProfitId = parentId + 1
  const stopLossId = parentId + 2
  const shared = { account, totalQuantity: proposal.quantity, outsideRth: false }

  const entry: Order = {
    ...shared,
    orderId: parentId,
    action: OrderAction.BUY,
    orderType: OrderType.LMT,
    lmtPrice: proposal.entryPrice,
    tif: TimeInForce.DAY,
    transmit: false,
  }
  const takeProfit: Order = {
    ...shared,
    orderId: takeProfitId,
    parentId,
    action: OrderAction.SELL,
    orderType: OrderType.LMT,
    lmtPrice: proposal.takeProfit,
    tif: TimeInForce.GTC,
    transmit: false,
  }
  const stopLoss: Order = {
    ...shared,
    orderId: stopLossId,
    parentId,
    action: OrderAction.SELL,
    orderType: OrderType.STP,
    auxPrice: proposal.stopLoss,
    tif: TimeInForce.GTC,
    transmit: true,
  }

  // Subscribe before sending: IB reports rejections asynchronously, right after placeOrder.
  const orderIds = [parentId, takeProfitId, stopLossId]
  const rejection = firstValueFrom(
    client.error.pipe(
      filter((error) => orderIds.includes(error.reqId) && isOrderRejection(Number(error.code))),
      timeout(REJECTION_WAIT_MS)
    )
  ).catch(() => null)

  client.placeOrder(parentId, contract, entry)
  client.placeOrder(takeProfitId, contract, takeProfit)
  client.placeOrder(stopLossId, contract, stopLoss)

  const rejected = await rejection
  if (rejected) {
    const reason = (rejected.error?.message ?? rejected.message).replace(/<br>/g, ' ')
    throw new Error(`IB rechazó la orden: ${reason}`)
  }

  return { account, parentOrderId: parentId, takeProfitOrderId: takeProfitId, stopLossOrderId: stopLossId }
}

/** Cancelling the parent entry also cancels its take-profit and stop-loss children. */
export async function cancelOrder(orderId: number): Promise<void> {
  await requireTradableAccount()
  getApi().cancelOrder(orderId)
}
