import { randomUUID } from 'node:crypto'
import { analyzeTrend } from '../db/trend.js'
import { computeTechnicalSnapshot } from '../lib/indicators.js'
import { sanitizeOhlcvCandles } from '../lib/stock.js'
import { fetchSymbolData } from '../marketData.js'
import { fetchMarketCaps } from '../providers/nasdaqScreener.js'
import { fetchOhlcv } from '../technicalAnalysis.js'
import { ORDER_LIMITS } from './config.js'
import { placeBracketOrder } from './ibkr.js'
import { buildBracketProposal, type BracketProposal } from './proposal.js'

interface StoredProposal extends BracketProposal {
  id: string
  priceAsOf: string
  expiresAt: number
}

const proposals = new Map<string, StoredProposal>()
const confirmedByDay = new Map<string, number>()

const todayKey = (): string => new Date().toISOString().slice(0, 10)

function pruneExpired(): void {
  const now = Date.now()
  for (const [id, proposal] of proposals) {
    if (proposal.expiresAt <= now) proposals.delete(id)
  }
}

export class BrokerRequestError extends Error {}

/** Supports only refine the stop; without OHLCV the proposal falls back to the default % stop. */
async function fetchSupports(symbol: string): Promise<Array<{ level: number }>> {
  try {
    const { candles } = await fetchOhlcv(symbol, { lookbackDays: 260 })
    const { candles: cleanCandles } = sanitizeOhlcvCandles(candles)
    return cleanCandles.length >= 30 ? computeTechnicalSnapshot(symbol, cleanCandles).supports : []
  } catch {
    return []
  }
}

export async function createProposal(symbol: string, budgetUsd: number) {
  pruneExpired()

  const quote = await fetchSymbolData(symbol)
  const trend = analyzeTrend(quote)
  const supports = await fetchSupports(symbol)
  const marketCaps = await fetchMarketCaps()

  const result = buildBracketProposal(
    {
      symbol,
      price: quote.price,
      budgetUsd,
      supports,
      trendLabel: trend.label,
      yearChange: quote.yearChange,
      monthChange: quote.monthChange,
      rsi14: quote.rsi14 ?? null,
      marketCap: marketCaps.get(symbol) ?? null,
    },
    ORDER_LIMITS
  )
  if ('error' in result) {
    throw new BrokerRequestError(result.error)
  }

  const stored: StoredProposal = {
    ...result.proposal,
    id: randomUUID(),
    priceAsOf: quote.updatedAt,
    expiresAt: Date.now() + ORDER_LIMITS.proposalTtlMs,
  }
  proposals.set(stored.id, stored)
  return stored
}

export async function confirmProposal(id: string) {
  pruneExpired()
  const proposal = proposals.get(id)
  if (!proposal) {
    throw new BrokerRequestError('La propuesta no existe o venció. Generá una nueva.')
  }

  const confirmedToday = confirmedByDay.get(todayKey()) ?? 0
  if (confirmedToday >= ORDER_LIMITS.maxOrdersPerDay) {
    throw new BrokerRequestError(`Llegaste al máximo de ${ORDER_LIMITS.maxOrdersPerDay} órdenes por día.`)
  }

  // Delete first so a double-click can never send the same bracket twice.
  proposals.delete(id)
  const placed = await placeBracketOrder(proposal)
  confirmedByDay.set(todayKey(), confirmedToday + 1)
  return { proposal, ...placed }
}

export function getOrderLimits() {
  return {
    maxOrderUsd: ORDER_LIMITS.maxOrderUsd,
    maxOrdersPerDay: ORDER_LIMITS.maxOrdersPerDay,
    confirmedToday: confirmedByDay.get(todayKey()) ?? 0,
  }
}
