import { cancelOrder, getOpenOrders, placeMarketSell, toTickerSymbol } from '../broker/index.js'
import { closeTrade, type AgentDecisionKind, type AgentTrade } from './journal.js'

interface Position {
  symbol: string
  quantity: number
  avgCost: number | null
}

interface OpenOrder {
  orderId: number | string
  symbol: string
  action: string
}

type LogFn = (kind: AgentDecisionKind, detail: string, symbol?: string | null) => Promise<unknown>

const CANCEL_SETTLE_MS = 2000

export function minSlotUsd(equityUsd: number, maxPositions: number, minSlotFillPct: number): number {
  if (!(equityUsd > 0) || !(maxPositions > 0)) return 0
  return (equityUsd / maxPositions) * (minSlotFillPct / 100)
}

export function isUndersized(costBasisUsd: number, minUsd: number): boolean {
  return minUsd > 0 && costBasisUsd < minUsd
}

const sellsFor = (orders: OpenOrder[], ticker: string) =>
  orders.filter((order) => order.action.toUpperCase() === 'SELL' && toTickerSymbol(order.symbol) === ticker)

/**
 * Frees slots held by positions too small to matter: cancels their bracket and sells at market,
 * or cancels the entry if it never filled. Returns the symbols rotated out.
 */
export async function rotateUndersizedTrades(params: {
  trades: AgentTrade[]
  positions: Position[]
  orders: OpenOrder[]
  minUsd: number
  log: LogFn
}): Promise<string[]> {
  const { trades, positions, orders, minUsd, log } = params
  const rotated: string[] = []

  for (const trade of trades) {
    const ticker = toTickerSymbol(trade.symbol)
    const position = positions.find((row) => toTickerSymbol(row.symbol) === ticker && row.quantity > 0)
    const workingBuy = orders.find((order) => order.action.toUpperCase() === 'BUY' && toTickerSymbol(order.symbol) === ticker)

    if (!position) {
      if (!workingBuy || !isUndersized(trade.quantity * trade.entryPrice, minUsd)) continue
      try {
        await cancelOrder(trade.parentOrderId ?? workingBuy.orderId)
        await closeTrade(trade.id, 'rotated')
        await log('rotate', `Entrada sin ejecutar de US$${(trade.quantity * trade.entryPrice).toFixed(2)} cancelada para liberar el cupo.`, ticker)
        rotated.push(ticker)
      } catch (error) {
        await log('error', error instanceof Error ? error.message : 'No se pudo cancelar la entrada.', ticker)
      }
      continue
    }

    const costBasis = position.quantity * (position.avgCost ?? trade.entryPrice)
    if (!isUndersized(costBasis, minUsd)) continue

    try {
      for (const order of sellsFor(orders, ticker)) await cancelOrder(order.orderId)
      await new Promise((resolve) => setTimeout(resolve, CANCEL_SETTLE_MS))
      // Selling while the old stop is still live could fill both and leave the account short.
      if (sellsFor(await getOpenOrders(), ticker).length) {
        await log('skip', 'El stop/TP todavía no se canceló; la rotación se reintenta el próximo ciclo.', ticker)
        continue
      }
      const orderId = await placeMarketSell({ symbol: position.symbol, quantity: position.quantity })
      await closeTrade(trade.id, 'rotated')
      await log(
        'rotate',
        `Vendidas ${position.quantity} a mercado (#${orderId}): costo US$${costBasis.toFixed(2)} < mínimo por cupo US$${minUsd.toFixed(2)}.`,
        ticker
      )
      rotated.push(ticker)
    } catch (error) {
      await log('error', error instanceof Error ? error.message : 'No se pudo rotar la posición.', ticker)
    }
  }

  return rotated
}
