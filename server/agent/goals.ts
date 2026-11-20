import { AGENT_CONFIG } from './config.js'

const pctUsd = (equity: number, pct: number): number => {
  const base = AGENT_CONFIG.goalEquityUsd ?? equity
  if (!Number.isFinite(base) || base <= 0) return 0
  return Number(((base * pct) / 100).toFixed(2))
}

function resolveLimit(equity: number | null, pct: number | null, usd: number): number {
  if (pct != null) return pctUsd(equity ?? 0, pct)
  return usd
}

export interface ResolvedGoalLimits {
  equityBase: number | null
  dailyProfitUsd: number
  dailyLossUsd: number
  weeklyProfitUsd: number
  weeklyLossUsd: number
  usesPct: boolean
}

/** Convierte % del equity en topes USD para halt diario/semanal (P&L sigue en USD). */
export function resolveGoalLimits(equity: number | null): ResolvedGoalLimits {
  const equityBase =
    AGENT_CONFIG.goalEquityUsd ?? (Number.isFinite(equity) && equity! > 0 ? equity : null)
  const usesPct =
    AGENT_CONFIG.dailyProfitPct != null ||
    AGENT_CONFIG.dailyLossPct != null ||
    AGENT_CONFIG.weeklyProfitPct != null ||
    AGENT_CONFIG.weeklyLossPct != null

  return {
    equityBase,
    dailyProfitUsd: resolveLimit(equityBase, AGENT_CONFIG.dailyProfitPct, AGENT_CONFIG.dailyProfitUsd),
    dailyLossUsd: resolveLimit(equityBase, AGENT_CONFIG.dailyLossPct, AGENT_CONFIG.dailyLossUsd),
    weeklyProfitUsd: resolveLimit(equityBase, AGENT_CONFIG.weeklyProfitPct, AGENT_CONFIG.weeklyProfitUsd),
    weeklyLossUsd: resolveLimit(equityBase, AGENT_CONFIG.weeklyLossPct, AGENT_CONFIG.weeklyLossUsd),
    usesPct,
  }
}

export function formatGoalLabel(kind: 'profit' | 'loss', period: 'daily' | 'weekly', limits: ResolvedGoalLimits): string {
  const pct =
    period === 'daily'
      ? kind === 'profit'
        ? AGENT_CONFIG.dailyProfitPct
        : AGENT_CONFIG.dailyLossPct
      : kind === 'profit'
        ? AGENT_CONFIG.weeklyProfitPct
        : AGENT_CONFIG.weeklyLossPct
  const usd =
    period === 'daily'
      ? kind === 'profit'
        ? limits.dailyProfitUsd
        : limits.dailyLossUsd
      : kind === 'profit'
        ? limits.weeklyProfitUsd
        : limits.weeklyLossUsd

  if (pct != null) {
    const sign = kind === 'profit' ? '+' : '−'
    return `${sign}${pct}% equity (US$${usd.toFixed(2)})`
  }
  return kind === 'profit' ? `+US$${usd}` : `−US$${usd}`
}