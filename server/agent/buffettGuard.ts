import type { FundBundle } from './fundamentalsBrief.js'
import { extractFundamentalMetrics } from './fundamentalsBrief.js'

export function parseAgentSymbolList(raw: string | undefined): Set<string> {
  if (!raw?.trim()) return new Set()
  return new Set(
    raw
      .split(/[,;\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
  )
}

export function parseSectorList(raw: string | undefined): Set<string> {
  if (!raw?.trim()) return new Set()
  return new Set(
    raw
      .split(/[,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  )
}

export interface BuffettThresholds {
  minRoePct: number
  maxDebtToEquity: number
  minNetMarginPct: number
}

export function checkBlockedTicker(symbol: string, blocked: Set<string>): { ok: true } | { ok: false; reason: string } {
  const ticker = symbol.toUpperCase().replace(/\s+/g, '.')
  if (blocked.has(ticker)) {
    return { ok: false, reason: `Ticker bloqueado (${ticker}).` }
  }
  return { ok: true }
}

export function checkCircleOfCompetence(
  sector: string | null,
  allowedSectors: Set<string>,
  blockedSectors: Set<string>
): { ok: true } | { ok: false; reason: string } {
  const norm = sector?.trim().toLowerCase() ?? ''
  if (blockedSectors.size && norm && blockedSectors.has(norm)) {
    return { ok: false, reason: `Sector bloqueado (${sector}).` }
  }
  if (allowedSectors.size) {
    if (!norm) return { ok: false, reason: 'Sector desconocido; fuera del círculo de competencia.' }
    if (!allowedSectors.has(norm)) {
      return { ok: false, reason: `Sector no permitido (${sector}).` }
    }
  }
  return { ok: true }
}

/** Reglas duras estilo Buffett (ROE, apalancamiento, margen). Sin datos → no bloquea. */
export function evaluateFundamentalsHard(
  bundle: FundBundle,
  thresholds: BuffettThresholds
): { ok: true } | { ok: false; reason: string } {
  const m = extractFundamentalMetrics(bundle)

  if (m.roe != null && m.roe < thresholds.minRoePct) {
    return { ok: false, reason: `ROE ${m.roe.toFixed(1)}% bajo mínimo ${thresholds.minRoePct}%.` }
  }
  if (m.debtToEquity != null && m.debtToEquity > thresholds.maxDebtToEquity) {
    return {
      ok: false,
      reason: `Deuda/equity ${m.debtToEquity.toFixed(2)} supera máximo ${thresholds.maxDebtToEquity}.`,
    }
  }
  if (m.netMargin != null && m.netMargin < thresholds.minNetMarginPct) {
    return {
      ok: false,
      reason: `Margen neto ${m.netMargin.toFixed(1)}% bajo mínimo ${thresholds.minNetMarginPct}%.`,
    }
  }
  return { ok: true }
}

const BASE_LABEL_BOOST: Record<string, number> = {
  'Early breakout': 12,
  'Pullback bounce': 10,
  Reversal: 8,
  Momentum: 4,
}

/** Mr. Market: penaliza perseguir momentum extendido; favorece pullback en zona RSI media. */
export function mrMarketLabelBoost(
  trendLabel: string,
  rsi14: number | null | undefined,
  monthChange: number | null | undefined,
  enabled: boolean
): number {
  const base = BASE_LABEL_BOOST[trendLabel] ?? 0
  if (!enabled) return base

  const rsi = Number.isFinite(rsi14) ? Number(rsi14) : null
  const month = Number.isFinite(monthChange) ? Number(monthChange) : null

  if (trendLabel === 'Momentum') {
    if ((rsi != null && rsi > 65) || (month != null && month > 22)) return base - 10
    return base
  }
  if (trendLabel === 'Pullback bounce' && rsi != null && rsi >= 35 && rsi <= 55) {
    return base + 4
  }
  if (trendLabel === 'Early breakout' && month != null && month > 28) {
    return Math.max(0, base - 6)
  }
  return base
}

export function rankScoreWithDiscipline(
  trendScore: number,
  trendLabel: string,
  rsi14: number | null | undefined,
  monthChange: number | null | undefined,
  mrMarketDiscipline: boolean
): number {
  return trendScore + mrMarketLabelBoost(trendLabel, rsi14, monthChange, mrMarketDiscipline)
}