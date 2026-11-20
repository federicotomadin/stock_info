import { isBelowMinMarketCap, isOverextendedEntry } from '../../shared/entryGuards.js'
import { RECOMMENDATION_GUARDS } from '../../shared/trendAnalysisConstants.js'
import type { OrderLimits } from './config.js'

export interface BracketProposalInput {
  symbol: string
  price: number
  budgetUsd: number
  supports: Array<{ level: number }>
  trendLabel: string
  yearChange: number | null
  monthChange: number | null
  rsi14: number | null
  marketCap: number | null
}

export interface BracketProposal {
  symbol: string
  quantity: number
  entryPrice: number
  stopLoss: number
  takeProfit: number
  notionalUsd: number
  riskUsd: number
  stopSource: 'support' | 'percent'
  trendLabel: string
}

export type BracketProposalResult =
  | { ok: true; proposal: BracketProposal }
  | { ok: false; error: string }

const toCents = (value: number): number => Math.round(value * 100) / 100

// Place the stop slightly under the support so a touch of the level doesn't trigger it.
const SUPPORT_STOP_BUFFER = 0.005

function pickStopLoss(
  price: number,
  supports: Array<{ level: number }>,
  limits: OrderLimits
): { stopLoss: number; stopSource: BracketProposal['stopSource'] } {
  const nearestSupport = supports
    .map((support) => support.level)
    .filter((level) => Number.isFinite(level) && level < price)
    .sort((a, b) => b - a)[0]

  if (nearestSupport != null) {
    const stopLoss = toCents(nearestSupport * (1 - SUPPORT_STOP_BUFFER))
    const distancePct = ((price - stopLoss) / price) * 100
    if (distancePct >= limits.minStopPct && distancePct <= limits.maxStopPct) {
      return { stopLoss, stopSource: 'support' }
    }
  }

  return { stopLoss: toCents(price * (1 - limits.defaultStopPct / 100)), stopSource: 'percent' }
}

export function buildBracketProposal(
  input: BracketProposalInput,
  limits: OrderLimits
): BracketProposalResult {
  const { symbol, price, budgetUsd, trendLabel } = input

  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
    return { ok: false, error: 'El presupuesto tiene que ser un monto positivo.' }
  }
  if (budgetUsd > limits.maxOrderUsd) {
    return { ok: false, error: `El presupuesto supera el máximo por orden (US$${limits.maxOrderUsd}).` }
  }
  if (!Number.isFinite(price) || price < limits.minPrice) {
    return { ok: false, error: `Precio inválido o menor a US$${limits.minPrice}.` }
  }
  if (!Number.isFinite(input.yearChange)) {
    return { ok: false, error: 'Cotiza hace menos de un año: sin tendencia confirmada.' }
  }
  if (!Number.isFinite(input.marketCap)) {
    return { ok: false, error: 'No se pudo verificar la capitalización de mercado de la acción.' }
  }
  if (isBelowMinMarketCap(input.marketCap)) {
    const capMillions = Math.round(input.marketCap! / 1e6).toLocaleString('es-AR')
    const minMillions = (RECOMMENDATION_GUARDS.minMarketCapUsd / 1e6).toLocaleString('es-AR')
    return {
      ok: false,
      error: `Capitalización de US$${capMillions} M, por debajo del mínimo de US$${minMillions} M.`,
    }
  }
  if (trendLabel === 'Downtrend') {
    return { ok: false, error: 'La acción está en tendencia bajista.' }
  }
  if (isOverextendedEntry({ label: trendLabel, rsi14: input.rsi14, monthChange: input.monthChange })) {
    const rsi = Number.isFinite(input.rsi14) ? input.rsi14!.toFixed(1) : 'N/A'
    const month = Number.isFinite(input.monthChange) ? `${input.monthChange!.toFixed(1)}%` : 'N/A'
    const { maxRsiForBullishEntry, maxMomentumMonthChange } = RECOMMENDATION_GUARDS
    return {
      ok: false,
      error:
        `Entrada sobreextendida (${trendLabel}): RSI ${rsi} (máx. ${maxRsiForBullishEntry}), ` +
        `suba 1M ${month} (máx. ${maxMomentumMonthChange}%). Riesgo de corrección.`,
    }
  }

  const entryPrice = toCents(price)
  const quantity = Math.floor(budgetUsd / entryPrice)
  if (quantity < 1) {
    return { ok: false, error: 'El presupuesto no alcanza para comprar una acción.' }
  }

  const { stopLoss, stopSource } = pickStopLoss(entryPrice, input.supports, limits)
  const takeProfit = toCents(entryPrice + (entryPrice - stopLoss) * limits.rewardRiskRatio)

  return {
    ok: true,
    proposal: {
      symbol,
      quantity,
      entryPrice,
      stopLoss,
      takeProfit,
      notionalUsd: toCents(quantity * entryPrice),
      riskUsd: toCents(quantity * (entryPrice - stopLoss)),
      stopSource,
      trendLabel,
    },
  }
}

export type AgentSizingMode = 'risk' | 'cash'

export interface SizeProposalOptions {
  equityUsd: number
  cashUsd: number
  riskPct: number
  maxOrderUsd: number
  /** risk = % equity at stop; cash = split available cash across open slots. */
  sizingMode?: AgentSizingMode
  /** In cash mode: fraction of (cash / openSlots) to deploy per entry (e.g. 90). */
  cashDeployPct?: number
  openSlots?: number
  /** In cash mode: reject entries smaller than this, so a fresh buy is never rotated out next cycle. */
  minNotionalUsd?: number
}

/** Caps quantity by risk %, cash deploy target, and per-order notional. */
export function sizeProposalByRisk(proposal: BracketProposal, opts: SizeProposalOptions): BracketProposalResult {
  const perShareRisk = proposal.entryPrice - proposal.stopLoss
  if (!(perShareRisk > 0)) {
    return { ok: false, error: 'El stop quedó al mismo precio que la entrada.' }
  }
  if (!(opts.equityUsd > 0)) {
    return { ok: false, error: 'No se pudo leer el equity de la cuenta IB.' }
  }

  const byNotional = Math.floor(opts.maxOrderUsd / proposal.entryPrice)
  const byCash = Math.floor(Math.max(0, opts.cashUsd) / proposal.entryPrice)

  let quantity: number
  if (opts.sizingMode === 'cash') {
    const slots = Math.max(1, opts.openSlots ?? 1)
    const deployPct = Math.min(100, Math.max(1, opts.cashDeployPct ?? 85))
    const targetUsd = Math.min(
      opts.maxOrderUsd,
      (Math.max(0, opts.cashUsd) / slots) * (deployPct / 100)
    )
    const byDeploy = Math.floor(targetUsd / proposal.entryPrice)
    quantity = Math.min(byDeploy, byCash, byNotional)
  } else {
    const riskBudget = opts.equityUsd * (opts.riskPct / 100)
    const byRisk = Math.floor(riskBudget / perShareRisk)
    quantity = Math.min(byRisk, byNotional, byCash)
  }

  if (quantity < 1) {
    return {
      ok: false,
      error:
        opts.sizingMode === 'cash'
          ? 'El cash disponible no alcanza para una acción con el tope por orden.'
          : 'El presupuesto de riesgo no alcanza para una acción con este stop.',
    }
  }

  const notionalUsd = toCents(quantity * proposal.entryPrice)
  if (opts.sizingMode === 'cash' && opts.minNotionalUsd && notionalUsd < opts.minNotionalUsd) {
    return {
      ok: false,
      error: `La posición quedaría en US$${notionalUsd}, por debajo del mínimo por cupo (US$${toCents(opts.minNotionalUsd)}).`,
    }
  }

  return {
    ok: true,
    proposal: {
      ...proposal,
      quantity,
      notionalUsd,
      riskUsd: toCents(quantity * perShareRisk),
    },
  }
}
