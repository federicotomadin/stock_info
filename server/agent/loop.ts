import { ALPACA_CONFIG, BROKER_PROVIDER, IBKR_CONFIG, ORDER_LIMITS } from '../broker/config.js'
import {
  getAccountSnapshot,
  getBrokerStatus,
  getExecutionsSince,
  getOpenOrders,
  getPositions,
  placeBracketOrder,
  toTickerSymbol,
  type AccountSnapshot,
  type BrokerStatus,
} from '../broker/index.js'
import { getOrderLimits, recordConfirmedOrder } from '../broker/service.js'
import { sizeProposalByRisk } from '../broker/proposal.js'
import { fetchSymbolData } from '../marketData.js'
import { AGENT_CONFIG } from './config.js'
import { evaluateDayHalt, evaluateWeekHalt, sessionPnl, countLiveEntriesToday, computeWeeklyPnl } from './dayPlan.js'
import { formatGoalLabel, resolveGoalLimits } from './goals.js'
import {
  expireOrphanTrades,
  finishAgentRun,
  listDecisions,
  listOpenTrades,
  listTradesOpenedOn,
  logDecision,
  recordTrade,
  startAgentRun,
} from './journal.js'
import { manageOpenPositions } from './manage.js'
import { isAfterNyCashClose, isUsEquitySession, nyCalendarDate, nyWeekStart } from './marketHours.js'
import { sendDailySessionReport } from './report.js'
import { minSlotUsd, rotateUndersizedTrades } from './rotate.js'
import { findEntryCandidates } from './scan.js'
import { getSessionDay, touchSessionDay, upsertFills } from './session.js'
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

function positionMarketValue(position: {
  quantity: number
  avgCost: number | null
  marketPrice: number | null
}): number {
  const px = position.marketPrice ?? position.avgCost ?? 0
  return position.quantity > 0 && px > 0 ? position.quantity * px : 0
}

function heldSymbols(
  positions: Array<{ symbol: string; quantity: number; avgCost: number | null; marketPrice: number | null }>,
  orders: Array<{ symbol: string; action: string }>
): Set<string> {
  const dustMin = AGENT_CONFIG.dustPositionUsd
  const held = new Set(
    positions
      .filter((position) => positionMarketValue(position) >= dustMin)
      .map((position) => toTickerSymbol(position.symbol))
  )
  for (const order of orders) {
    if (order.action === 'BUY') held.add(toTickerSymbol(order.symbol))
  }
  return held
}

async function maybeEnter(
  snapshot: AccountSnapshot,
  held: Set<string>,
  runId: number,
  openSlots: number
): Promise<string | null> {
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
    await logDecision(
      runId,
      'skip',
      candidates.length
        ? 'Ningún candidato del screener pasó los filtros de entrada.'
        : 'No hay mid/large caps (≥ US$2.000 M) con setup de entrada. El ranking crudo está lleno de microcaps.'
    )
    return 'sin entradas'
  }

  for (const candidate of viable.slice(0, 8)) {
    let proposal = candidate.proposal!
    try {
      const quote = await fetchSymbolData(candidate.symbol)
      if (Number.isFinite(quote.price) && quote.price > 0 && proposal.entryPrice > 0) {
        const scale = quote.price / proposal.entryPrice
        if (scale > 0.85 && scale < 1.15) {
          const round = (n: number) => Math.round(n * 100) / 100
          proposal = {
            ...proposal,
            entryPrice: round(quote.price),
            stopLoss: round(proposal.stopLoss * scale),
            takeProfit: round(proposal.takeProfit * scale),
          }
        }
      }
    } catch {
      /* keep screener prices */
    }

    const sized = sizeProposalByRisk(proposal, {
      equityUsd: snapshot.netLiquidation ?? 0,
      cashUsd: snapshot.cash ?? ORDER_LIMITS.maxOrderUsd,
      riskPct: AGENT_CONFIG.riskPct,
      maxOrderUsd: ORDER_LIMITS.maxOrderUsd,
      sizingMode: AGENT_CONFIG.sizingMode,
      cashDeployPct: AGENT_CONFIG.cashDeployPct,
      openSlots,
      minNotionalUsd: minSlotUsd(snapshot.netLiquidation ?? 0, AGENT_CONFIG.maxPositions, AGENT_CONFIG.minSlotFillPct),
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

    try {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'IB rechazó la orden.'
      await logDecision(runId, 'reject', message, candidate.symbol)
      continue
    }
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
      await logDecision(
        runId,
        'skip',
        broker.reason ?? (BROKER_PROVIDER === 'alpaca' ? 'Alpaca no conectado.' : 'IB Gateway no está conectado.')
      )
      return finish(
        'skipped',
        broker.reason ?? (BROKER_PROVIDER === 'alpaca' ? 'Sin conexión a Alpaca.' : 'Sin conexión a IB.')
      )
    }
    const liveAgentOk =
      BROKER_PROVIDER === 'alpaca'
        ? ALPACA_CONFIG.paper || (ALPACA_CONFIG.allowLive && AGENT_CONFIG.allowLive)
        : IBKR_CONFIG.allowLive && AGENT_CONFIG.allowLive
    if (!broker.paper && !liveAgentOk) {
      await logDecision(
        runId,
        'skip',
        BROKER_PROVIDER === 'alpaca'
          ? 'Alpaca live: activá ALPACA_ALLOW_LIVE=true y AGENT_ALLOW_LIVE=true.'
          : 'Cuenta real: activá IBKR_ALLOW_LIVE=true y AGENT_ALLOW_LIVE=true en .env (solo local).'
      )
      return finish('skipped', 'Cuenta real bloqueada para el agente.')
    }
    if (!broker.paper && !broker.tradingAllowed) {
      await logDecision(runId, 'skip', broker.reason ?? 'Cuenta real no habilitada para operar.')
      return finish('skipped', broker.reason ?? 'Sin permiso para operar en real.')
    }

    snapshot = await getAccountSnapshot()
    const today = nyCalendarDate()
    await touchSessionDay(today, snapshot.netLiquidation)
    try {
      const since = nyCalendarDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
      await upsertFills(await getExecutionsSince(since))
    } catch {
      /* executions are optional; the session P&L still works from Net Liquidation */
    }

    // One automatic email per NY session, after the cash close (not every 15 min).
    if (isAfterNyCashClose()) {
      const reportDay = nyCalendarDate()
      await touchSessionDay(reportDay, snapshot.netLiquidation)
      try {
        const mailed = await sendDailySessionReport(reportDay, snapshot)
        if (mailed.sent || !mailed.reason.includes('ya se envió')) {
          await logDecision(runId, mailed.sent ? 'scan' : 'skip', mailed.reason)
        }
      } catch (error) {
        await logDecision(runId, 'error', `Mail diario: ${error instanceof Error ? error.message : 'falló el envío.'}`)
      }
    }

    if (!opts.ignoreHours && !AGENT_CONFIG.allowOutsideHours && !isUsEquitySession()) {
      const summary = 'Mercado cerrado (NYSE 9:30–16:00 ET). Usá “Probar ahora” para un ciclo de práctica.'
      await logDecision(runId, 'skip', summary)
      return finish('skipped', summary)
    }
    const positions = await getPositions()
    const orders = await getOpenOrders()
    await manageOpenPositions(positions, orders, (kind, detail, symbol) => logDecision(runId, kind, detail, symbol))

    const minSlot =
      AGENT_CONFIG.sizingMode === 'cash'
        ? minSlotUsd(snapshot.netLiquidation ?? 0, AGENT_CONFIG.maxPositions, AGENT_CONFIG.minSlotFillPct)
        : 0
    if (minSlot > 0) {
      const rotated = await rotateUndersizedTrades({
        trades: await listOpenTrades(),
        positions: await getPositions(),
        orders: await getOpenOrders(),
        minUsd: minSlot,
        log: (kind, detail, symbol) => logDecision(runId, kind, detail, symbol),
      })
      if (rotated.length) {
        const summary = `Rotó ${rotated.join(', ')} (posiciones chicas). Compra con el cash liberado en el próximo ciclo.`
        await logDecision(runId, 'scan', summary)
        return finish('ok', summary)
      }
    }

    const afterPositions = await getPositions()
    const afterOrders = await getOpenOrders()
    const held = heldSymbols(afterPositions, afterOrders)
    const workingBuys = new Set(
      afterOrders.filter((order) => order.action === 'BUY').map((order) => toTickerSymbol(order.symbol))
    )
    await expireOrphanTrades(held, workingBuys, afterOrders)

    const agentOpenTrades = await listOpenTrades()
    const agentSlotCount = agentOpenTrades.length

    if (agentSlotCount >= AGENT_CONFIG.maxPositions) {
      const summary = `Máximo de ${AGENT_CONFIG.maxPositions} trades abiertos del agente. Solo se gestionaron stops.`
      await logDecision(runId, 'skip', summary)
      return finish('ok', summary)
    }

    const submittedToday = (await listTradesOpenedOn(today)).map((trade) => trade.symbol)
    const placedToday = countLiveEntriesToday(submittedToday, held, workingBuys)
    if (placedToday >= ORDER_LIMITS.maxOrdersPerDay) {
      const summary = `Tope diario de ${ORDER_LIMITS.maxOrdersPerDay} órdenes vivas. Solo se gestionaron stops.`
      await logDecision(runId, 'skip', summary)
      return finish('ok', summary)
    }

    const session = await getSessionDay(today)
    const pnl = sessionPnl(session?.openNl ?? snapshot.netLiquidation, snapshot.netLiquidation) ?? 0
    const goals = resolveGoalLimits(snapshot.netLiquidation)
    const halt = evaluateDayHalt(pnl, goals.dailyProfitUsd, goals.dailyLossUsd)
    if (halt.halt) {
      const summary =
        halt.reason === 'profit'
          ? `Meta diaria ${formatGoalLabel('profit', 'daily', goals)} alcanzada (P&L ${halt.pnl.toFixed(2)}). No abre trades nuevos.`
          : `Stop diario ${formatGoalLabel('loss', 'daily', goals)} tocado (P&L ${halt.pnl.toFixed(2)}). No abre trades nuevos.`
      await logDecision(runId, 'skip', summary)
      return finish('ok', summary)
    }

    const weekPnl = (await computeWeeklyPnl(today, snapshot.netLiquidation)) ?? 0
    const weekHalt = evaluateWeekHalt(weekPnl, goals.weeklyProfitUsd, goals.weeklyLossUsd)
    if (weekHalt.halt) {
      const summary =
        weekHalt.reason === 'profit'
          ? `Meta semanal ${formatGoalLabel('profit', 'weekly', goals)} alcanzada (P&L sem. ${weekHalt.pnl.toFixed(2)}). No abre trades nuevos.`
          : `Stop semanal ${formatGoalLabel('loss', 'weekly', goals)} tocado (P&L sem. ${weekHalt.pnl.toFixed(2)}). No abre trades nuevos.`
      await logDecision(runId, 'skip', summary)
      return finish('ok', summary)
    }

    const slotsForNewEntries = Math.max(1, AGENT_CONFIG.maxPositions - agentOpenTrades.length)
    const bought = await maybeEnter(snapshot, held, runId, slotsForNewEntries)
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
  const today = nyCalendarDate()
  const [decisions, trades, session] = await Promise.all([listDecisions(20), listOpenTrades(), getSessionDay(today)])
  let liveNl: number | null = null
  if (broker.connected) {
    try {
      liveNl = (await getAccountSnapshot()).netLiquidation
    } catch {
      liveNl = null
    }
  }
  const dayPnl = sessionPnl(session?.openNl ?? null, liveNl ?? session?.closeNl ?? null)
  const goals = resolveGoalLimits(liveNl)
  const halt = evaluateDayHalt(dayPnl ?? 0, goals.dailyProfitUsd, goals.dailyLossUsd)
  const weekPnl = await computeWeeklyPnl(today, liveNl)
  const weekHalt = evaluateWeekHalt(weekPnl ?? 0, goals.weeklyProfitUsd, goals.weeklyLossUsd)
  const liveAgentEnabled =
    BROKER_PROVIDER === 'alpaca'
      ? ALPACA_CONFIG.paper || (ALPACA_CONFIG.allowLive && AGENT_CONFIG.allowLive)
      : IBKR_CONFIG.allowLive && AGENT_CONFIG.allowLive
  return {
    enabled: AGENT_CONFIG.enabled,
    running: runtime.running,
    busy: runtime.busy,
    paperOnly: BROKER_PROVIDER === 'alpaca' ? ALPACA_CONFIG.paper : !liveAgentEnabled,
    brokerProvider: BROKER_PROVIDER,
    intervalMs: AGENT_CONFIG.intervalMs,
    lastCycle: runtime.lastCycle,
    broker,
    limits: getOrderLimits(),
    day: {
      sessionDate: today,
      pnl: dayPnl,
      halt: halt.halt ? halt.reason : null,
    },
    week: {
      weekStart: nyWeekStart(today),
      pnl: weekPnl,
      halt: weekHalt.halt ? weekHalt.reason : null,
    },
    config: {
      maxPositions: AGENT_CONFIG.maxPositions,
      riskPct: AGENT_CONFIG.riskPct,
      sizingMode: AGENT_CONFIG.sizingMode,
      cashDeployPct: AGENT_CONFIG.cashDeployPct,
      maxOrderUsd: ORDER_LIMITS.maxOrderUsd,
      maxOrdersPerDay: ORDER_LIMITS.maxOrdersPerDay,
      aiVeto: AGENT_CONFIG.aiVeto,
      allowOutsideHours: AGENT_CONFIG.allowOutsideHours,
      dailyProfitUsd: goals.dailyProfitUsd,
      dailyLossUsd: goals.dailyLossUsd,
      weeklyProfitUsd: goals.weeklyProfitUsd,
      weeklyLossUsd: goals.weeklyLossUsd,
      dailyProfitPct: AGENT_CONFIG.dailyProfitPct,
      dailyLossPct: AGENT_CONFIG.dailyLossPct,
      weeklyProfitPct: AGENT_CONFIG.weeklyProfitPct,
      weeklyLossPct: AGENT_CONFIG.weeklyLossPct,
      goalEquityUsd: goals.equityBase,
      reportEmail: AGENT_CONFIG.reportEmail || null,
      allowLive: liveAgentEnabled,
    },
    decisions,
    trades,
  }
}

export type { AgentDecision } from './journal.js'
