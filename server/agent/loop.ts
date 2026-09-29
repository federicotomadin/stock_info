import { ORDER_LIMITS } from '../broker/config.js'
import {
  getAccountSnapshot,
  getBrokerStatus,
  getOpenOrders,
  getPositions,
  placeBracketOrder,
  toTickerSymbol,
  type AccountSnapshot,
  type BrokerStatus,
} from '../broker/ibkr.js'
import { getOrderLimits, recordConfirmedOrder } from '../broker/service.js'
import { sizeProposalByRisk } from '../broker/proposal.js'
import { AGENT_CONFIG } from './config.js'
import {
  countPlacedToday,
  finishAgentRun,
  listDecisions,
  listOpenTrades,
  logDecision,
  recordTrade,
  startAgentRun,
} from './journal.js'
import { manageOpenPositions } from './manage.js'
import { isUsEquitySession } from './marketHours.js'
import { findEntryCandidates } from './scan.js'
import { vetoEntry } from './veto.js'

export interface AgentCycleResult {
  at: string
  status: 'ok' | 'skipped' | 'error'
  summary: string
  snapshot: AccountSnapshot | null
}

interface AgentRuntime {
  running: boolean
  busy: boolean
  timer: ReturnType<typeof setInterval> | null
  lastCycle: AgentCycleResult | null
}

const runtime: AgentRuntime = {
  running: false,
  busy: false,
  timer: null,
  lastCycle: null,
}

function heldSymbols(
  positions: Array<{ symbol: string }>,
  orders: Array<{ symbol: string; action: string }>
): Set<string> {
  const held = new Set(positions.map((position) => toTickerSymbol(position.symbol)))
  for (const order of orders) {
    if (order.action === 'BUY') held.add(toTickerSymbol(order.symbol))
  }
  return held
}

async function maybeEnter(snapshot: AccountSnapshot, held: Set<string>, runId: number): Promise<string | null> {
  const candidates = await findEntryCandidates(held)
  const rejected = candidates.filter((candidate) => candidate.rejected).slice(0, 5)
  if (rejected.length) {
    await logDecision(
      runId,
      'scan',
      `Filtrados: ${rejected.map((candidate) => `${candidate.symbol} (${candidate.rejected})`).join('; ')}`
    )
  }

  const viable = candidates.filter((candidate) => candidate.proposal)
  if (!viable.length) {
    await logDecision(runId, 'skip', 'Ningún candidato del screener pasó los filtros de entrada.')
    return 'sin entradas'
  }

  for (const candidate of viable.slice(0, 3)) {
    const proposal = candidate.proposal!
    const sized = sizeProposalByRisk(proposal, {
      equityUsd: snapshot.netLiquidation ?? 0,
      cashUsd: snapshot.cash ?? ORDER_LIMITS.maxOrderUsd,
      riskPct: AGENT_CONFIG.riskPct,
      maxOrderUsd: ORDER_LIMITS.maxOrderUsd,
    })
    if ('error' in sized) {
      await logDecision(runId, 'reject', sized.error, candidate.symbol)
      continue
    }

    const veto = await vetoEntry(sized.proposal, { name: candidate.name, trendLabel: candidate.trendLabel })
    if (!veto.approved) {
      await logDecision(runId, 'veto', veto.reason, candidate.symbol)
      continue
    }
    if (veto.reason) {
      await logDecision(runId, 'scan', veto.reason, candidate.symbol)
    }

    const placed = await placeBracketOrder(sized.proposal)
    recordConfirmedOrder()
    await recordTrade({
      symbol: sized.proposal.symbol,
      quantity: sized.proposal.quantity,
      entryPrice: sized.proposal.entryPrice,
      stopLoss: sized.proposal.stopLoss,
      takeProfit: sized.proposal.takeProfit,
      parentOrderId: placed.parentOrderId,
      stopOrderId: placed.stopLossOrderId,
      takeProfitOrderId: placed.takeProfitOrderId,
      reason: `${candidate.trendLabel} · ${veto.reason}`,
    })
    await logDecision(
      runId,
      'buy',
      `${sized.proposal.quantity} × ${sized.proposal.entryPrice} · stop ${sized.proposal.stopLoss} · TP ${sized.proposal.takeProfit}`,
      candidate.symbol
    )
    return candidate.symbol
  }

  await logDecision(runId, 'skip', 'Los candidatos viables fueron vetados o no se pudieron dimensionar.')
  return 'sin entradas'
}

export async function runAgentCycle(opts: { ignoreHours?: boolean } = {}): Promise<AgentCycleResult> {
  if (runtime.busy) {
    return runtime.lastCycle ?? { at: new Date().toISOString(), status: 'skipped', summary: 'Ya hay un ciclo en curso.', snapshot: null }
  }

  runtime.busy = true
  const at = new Date().toISOString()
  const runId = await startAgentRun()
  let snapshot: AccountSnapshot | null = null

  const finish = async (status: AgentCycleResult['status'], summary: string): Promise<AgentCycleResult> => {
    await finishAgentRun(runId, status, summary)
    const result = { at, status, summary, snapshot }
    runtime.lastCycle = result
    return result
  }

  try {
    const broker = await getBrokerStatus()
    if (!broker.connected || !broker.account) {
      await logDecision(runId, 'skip', broker.reason ?? 'IB Gateway no está conectado.')
      return finish('skipped', broker.reason ?? 'Sin conexión a IB.')
    }
    if (!broker.paper) {
      await logDecision(runId, 'skip', 'El agente solo opera la cuenta paper (prefijo DU/DF).')
      return finish('skipped', 'Cuenta real: el agente no opera. Usá paper.')
    }
    if (!opts.ignoreHours && !AGENT_CONFIG.allowOutsideHours && !isUsEquitySession()) {
      const summary = 'Mercado cerrado (NYSE 9:30–16:00 ET). Usá “Probar ahora” para un ciclo de práctica.'
      await logDecision(runId, 'skip', summary)
      return finish('skipped', summary)
    }

    snapshot = await getAccountSnapshot()
    const positions = await getPositions()
    const orders = await getOpenOrders()
    await manageOpenPositions(positions, orders, (kind, detail, symbol) => logDecision(runId, kind, detail, symbol))

    const afterPositions = await getPositions()
    const afterOrders = await getOpenOrders()
    const longCount = afterPositions.filter((position) => position.quantity > 0).length

    if (longCount >= AGENT_CONFIG.maxPositions) {
      const summary = `Máximo de ${AGENT_CONFIG.maxPositions} posiciones. Solo se gestionaron stops.`
      await logDecision(runId, 'skip', summary)
      return finish('ok', summary)
    }

    const placedToday = Math.max(getOrderLimits().confirmedToday, await countPlacedToday())
    if (placedToday >= ORDER_LIMITS.maxOrdersPerDay) {
      const summary = `Tope diario de ${ORDER_LIMITS.maxOrdersPerDay} órdenes. Solo se gestionaron stops.`
      await logDecision(runId, 'skip', summary)
      return finish('ok', summary)
    }

    const bought = await maybeEnter(snapshot, heldSymbols(afterPositions, afterOrders), runId)
    return finish('ok', bought && bought !== 'sin entradas' ? `Compró ${bought} y actualizó stops.` : 'Ciclo ok: se revisaron stops, sin compra nueva.')
  } catch (error) {
    const summary = error instanceof Error ? error.message : 'Error inesperado en el agente.'
    await logDecision(runId, 'error', summary)
    return finish('error', summary)
  } finally {
    runtime.busy = false
  }
}

export function startAgent(): { error: string } | { ok: true } {
  if (!AGENT_CONFIG.enabled) {
    return { error: 'El agente está apagado. Poné AGENT_ENABLED=true en el .env local.' }
  }
  if (!runtime.running) {
    runtime.running = true
    runtime.timer = setInterval(() => {
      void runAgentCycle()
    }, AGENT_CONFIG.intervalMs)
  }
  return { ok: true }
}

export function stopAgent(): void {
  if (runtime.timer) clearInterval(runtime.timer)
  runtime.timer = null
  runtime.running = false
}

export async function getAgentSnapshot(broker: BrokerStatus) {
  const [decisions, trades] = await Promise.all([listDecisions(20), listOpenTrades()])
  return {
    enabled: AGENT_CONFIG.enabled,
    running: runtime.running,
    busy: runtime.busy,
    paperOnly: true as const,
    intervalMs: AGENT_CONFIG.intervalMs,
    lastCycle: runtime.lastCycle,
    broker,
    limits: getOrderLimits(),
    config: {
      maxPositions: AGENT_CONFIG.maxPositions,
      riskPct: AGENT_CONFIG.riskPct,
      maxOrderUsd: ORDER_LIMITS.maxOrderUsd,
      maxOrdersPerDay: ORDER_LIMITS.maxOrdersPerDay,
      aiVeto: AGENT_CONFIG.aiVeto,
      allowOutsideHours: AGENT_CONFIG.allowOutsideHours,
    },
    decisions,
    trades,
  }
}

export type { AgentDecision } from './journal.js'
