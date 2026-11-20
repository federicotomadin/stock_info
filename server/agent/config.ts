import 'dotenv/config'
import type { AgentSizingMode } from '../broker/proposal.js'
import { parseAgentSymbolList, parseSectorList } from './buffettGuard.js'

const numberFromEnv = (name: string, fallback: number): number => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/** % del equity (ej. 5 = 5% → US$5.000 sobre US$100k). Si está definido, tiene prioridad sobre *_USD. */
const optionalPositive = (name: string): number | null => {
  const raw = process.env[name]?.trim()
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

const optionalEquity = (): number | null => {
  const raw = process.env.AGENT_GOAL_EQUITY_USD?.trim()
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

export const AGENT_CONFIG = {
  enabled: process.env.AGENT_ENABLED === 'true',
  /** Requires IBKR_ALLOW_LIVE=true as well; checked in the agent loop. */
  allowLive: process.env.AGENT_ALLOW_LIVE === 'true',
  intervalMs: numberFromEnv('AGENT_INTERVAL_MS', 15 * 60 * 1000),
  maxPositions: numberFromEnv('AGENT_MAX_POSITIONS', 5),
  /** Percent of NetLiquidation risked on each new trade (the stop distance sets the share count). */
  riskPct: numberFromEnv('AGENT_RISK_PCT', 1),
  sizingMode: (process.env.AGENT_SIZING === 'cash' ? 'cash' : 'risk') as AgentSizingMode,
  cashDeployPct: numberFromEnv('AGENT_CASH_DEPLOY_PCT', 85),
  /** Cash mode: positions costing less than this % of (equity / maxPositions) get sold to free the slot. */
  minSlotFillPct: numberFromEnv('AGENT_MIN_SLOT_FILL_PCT', 60),
  scanLimit: numberFromEnv('AGENT_SCAN_LIMIT', 200),
  supportFetchLimit: numberFromEnv('AGENT_SUPPORT_FETCH_LIMIT', 8),
  maxNewTradesPerRun: 1,
  allowOutsideHours: process.env.AGENT_ALLOW_OUTSIDE_HOURS === 'true',
  aiVeto: process.env.AGENT_AI_VETO !== 'false',
  /** Enriquece el veto IA con titulares recientes (tools/day-trader-skill/trader-news). */
  newsVeto: process.env.AGENT_NEWS_VETO === 'true',
  /** Fundamentales FMP/Finnhub en el veto (Buffett: ROE, deuda, margen). */
  buffettFundamentals: process.env.AGENT_BUFFETT_FUNDAMENTALS !== 'false',
  buffettHardRules: process.env.AGENT_BUFFETT_HARD_RULES !== 'false',
  mrMarketDiscipline: process.env.AGENT_MR_MARKET_DISCIPLINE !== 'false',
  buffettMinRoePct: numberFromEnv('AGENT_BUFFETT_MIN_ROE', 8),
  buffettMaxDebtToEquity: numberFromEnv('AGENT_BUFFETT_MAX_DEBT_EQUITY', 2.5),
  buffettMinNetMarginPct: numberFromEnv('AGENT_BUFFETT_MIN_NET_MARGIN', 0),
  blockedTickers: parseAgentSymbolList(process.env.AGENT_BLOCKED_TICKERS),
  blockedSectors: parseSectorList(process.env.AGENT_BLOCKED_SECTORS),
  /** Si no está vacío, solo estos sectores (círculo de competencia). */
  allowedSectors: parseSectorList(process.env.AGENT_ALLOWED_SECTORS),
  /** Fallback en USD si no hay AGENT_*_PROFIT_PCT / LOSS_PCT. */
  dailyProfitUsd: numberFromEnv('AGENT_DAILY_PROFIT_USD', 300),
  dailyLossUsd: numberFromEnv('AGENT_DAILY_LOSS_USD', 150),
  weeklyProfitUsd: numberFromEnv('AGENT_WEEKLY_PROFIT_USD', 50),
  weeklyLossUsd: numberFromEnv('AGENT_WEEKLY_LOSS_USD', 25),
  dailyProfitPct: optionalPositive('AGENT_DAILY_PROFIT_PCT'),
  dailyLossPct: optionalPositive('AGENT_DAILY_LOSS_PCT'),
  weeklyProfitPct: optionalPositive('AGENT_WEEKLY_PROFIT_PCT'),
  weeklyLossPct: optionalPositive('AGENT_WEEKLY_LOSS_PCT'),
  /** Base fija para convertir % → USD (ej. 100000 en paper). Si falta, usa Net Liquidation vivo. */
  goalEquityUsd: optionalEquity(),
  /** Positions below this market value are ignored for “already held” scans (dust). */
  dustPositionUsd: numberFromEnv('AGENT_DUST_POSITION_USD', 5),
  reportEmail: process.env.AGENT_REPORT_EMAIL?.trim() || '',
}

/** Arranca el loop sin POST /api/agent/start (p. ej. en Render con RENDER=true). */
export function shouldAutoStartAgent(): boolean {
  if (!AGENT_CONFIG.enabled) return false
  if (process.env.AGENT_AUTO_START === 'false') return false
  if (process.env.AGENT_AUTO_START === 'true') return true
  return process.env.RENDER === 'true'
}
