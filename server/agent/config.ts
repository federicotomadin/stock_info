import 'dotenv/config'

const numberFromEnv = (name: string, fallback: number): number => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export const AGENT_CONFIG = {
  enabled: process.env.AGENT_ENABLED === 'true',
  intervalMs: numberFromEnv('AGENT_INTERVAL_MS', 15 * 60 * 1000),
  maxPositions: numberFromEnv('AGENT_MAX_POSITIONS', 5),
  /** Percent of NetLiquidation risked on each new trade (the stop distance sets the share count). */
  riskPct: numberFromEnv('AGENT_RISK_PCT', 1),
  scanLimit: numberFromEnv('AGENT_SCAN_LIMIT', 200),
  supportFetchLimit: numberFromEnv('AGENT_SUPPORT_FETCH_LIMIT', 8),
  maxNewTradesPerRun: 1,
  allowOutsideHours: process.env.AGENT_ALLOW_OUTSIDE_HOURS === 'true',
  aiVeto: process.env.AGENT_AI_VETO !== 'false',
  dailyProfitUsd: numberFromEnv('AGENT_DAILY_PROFIT_USD', 300),
  dailyLossUsd: numberFromEnv('AGENT_DAILY_LOSS_USD', 150),
  reportEmail: process.env.AGENT_REPORT_EMAIL?.trim() || '',
}
