import { analyzeTrend } from '../db/trend.js'
import { fetchTechnicalContext } from '../lib/supports.js'
import { fetchSymbolData } from '../marketData.js'
import { ORDER_LIMITS } from '../broker/config.js'
import { modifyStopOrder, placeProtectiveStop, toTickerSymbol } from '../broker/ibkr.js'
import { defaultProtectiveStop, plannedStop } from './stops.js'
import { findOpenTrade, updateTradeStop, type AgentDecisionKind } from './journal.js'

interface Position {
  symbol: string
  quantity: number
  avgCost: number | null
  marketPrice: number | null
}

interface OpenOrder {
  orderId: number
  parentId: number | null
  symbol: string
  action: string
  orderType: string
  quantity: number
  stopPrice: number | null
}

type LogFn = (kind: AgentDecisionKind, detail: string, symbol?: string | null) => Promise<unknown>

function isStopOrder(order: OpenOrder): boolean {
  return order.action === 'SELL' && String(order.orderType).toUpperCase().includes('STP')
}

function stopForSymbol(orders: OpenOrder[], symbol: string): OpenOrder | undefined {
  const ticker = toTickerSymbol(symbol)
  return orders
    .filter((order) => isStopOrder(order) && toTickerSymbol(order.symbol) === ticker)
    .sort((a, b) => (b.stopPrice ?? 0) - (a.stopPrice ?? 0))[0]
}

export async function manageOpenPositions(
  positions: Position[],
  orders: OpenOrder[],
  log: LogFn
): Promise<void> {
  for (const position of positions) {
    if (!(position.quantity > 0)) continue

    const ticker = toTickerSymbol(position.symbol)
    const price = position.marketPrice && position.marketPrice > 0 ? position.marketPrice : null
    const avgCost = position.avgCost && position.avgCost > 0 ? position.avgCost : price
    if (!price || !avgCost) {
      await log('skip', 'Sin precio de mercado para ajustar el stop.', ticker)
      continue
    }

    const journal = await findOpenTrade(ticker)
    const existingStop = stopForSymbol(orders, position.symbol)
    const originalStop = journal?.originalStop ?? defaultProtectiveStop(price, avgCost, ORDER_LIMITS.defaultStopPct)
    const currentStop = existingStop?.stopPrice ?? journal?.stopLoss ?? originalStop

    if (!existingStop) {
      const stopPrice = Math.min(currentStop, defaultProtectiveStop(price, avgCost, ORDER_LIMITS.defaultStopPct))
      try {
        const orderId = await placeProtectiveStop({
          symbol: position.symbol,
          quantity: position.quantity,
          stopPrice,
        })
        if (journal) await updateTradeStop(journal.id, stopPrice, orderId)
        await log('protect', `Stop protector en ${stopPrice.toFixed(2)} (#${orderId}).`, ticker)
      } catch (error) {
        await log('error', error instanceof Error ? error.message : 'No se pudo crear el stop.', ticker)
      }
      continue
    }

    let downtrend = false
    try {
      downtrend = analyzeTrend(await fetchSymbolData(ticker)).label === 'Downtrend'
    } catch {
      downtrend = false
    }

    const { supports, sma20 } = await fetchTechnicalContext(ticker)
    const next = plannedStop({
      avgCost,
      originalStop,
      currentStop,
      currentPrice: price,
      supports: supports.map((support) => support.level),
      sma20,
      downtrend,
    })

    if (!next) continue

    try {
      await modifyStopOrder({
        orderId: existingStop.orderId,
        parentId: existingStop.parentId,
        symbol: position.symbol,
        quantity: position.quantity,
        stopPrice: next.stop,
      })
      if (journal) await updateTradeStop(journal.id, next.stop, existingStop.orderId)
      const kind: AgentDecisionKind = next.reason === 'breakeven' ? 'breakeven' : 'trail'
      await log(kind, `Stop a ${next.stop.toFixed(2)} (${next.reason}).`, ticker)
    } catch (error) {
      await log('error', error instanceof Error ? error.message : 'No se pudo modificar el stop.', ticker)
    }
  }
}
