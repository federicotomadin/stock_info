import 'dotenv/config'

const numberFromEnv = (name: string, fallback: number): number => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export const IBKR_CONFIG = {
  enabled: process.env.IBKR_ENABLED === 'true',
  host: process.env.IBKR_HOST?.trim() || '127.0.0.1',
  // 4002 = IB Gateway paper, 4001 = IB Gateway live, 7497/7496 = TWS paper/live.
  port: numberFromEnv('IBKR_PORT', 4002),
  clientId: numberFromEnv('IBKR_CLIENT_ID', 17),
  account: process.env.IBKR_ACCOUNT?.trim() || '',
  allowLive: process.env.IBKR_ALLOW_LIVE === 'true',
}

export interface OrderLimits {
  maxOrderUsd: number
  maxOrdersPerDay: number
  defaultStopPct: number
  minStopPct: number
  maxStopPct: number
  rewardRiskRatio: number
  minPrice: number
  proposalTtlMs: number
}

export const ORDER_LIMITS: OrderLimits = {
  maxOrderUsd: numberFromEnv('IBKR_MAX_ORDER_USD', 1000),
  maxOrdersPerDay: numberFromEnv('IBKR_MAX_ORDERS_PER_DAY', 3),
  defaultStopPct: numberFromEnv('IBKR_DEFAULT_STOP_PCT', 5),
  minStopPct: 2,
  maxStopPct: 10,
  rewardRiskRatio: 2,
  // Sub-$1 stocks use sub-penny ticks and are too erratic for a fixed-% bracket.
  minPrice: 1,
  proposalTtlMs: 5 * 60 * 1000,
}
