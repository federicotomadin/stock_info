import 'dotenv/config'

const numberFromEnv = (name: string, fallback: number): number => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export const BROKER_PROVIDER = (process.env.BROKER_PROVIDER || 'ibkr').trim().toLowerCase() as 'ibkr' | 'alpaca'

export const ALPACA_CONFIG = {
  apiKeyId: process.env.ALPACA_API_KEY_ID?.trim() || '',
  apiSecretKey: process.env.ALPACA_API_SECRET_KEY?.trim() || '',
  paper: process.env.ALPACA_PAPER !== 'false',
  allowLive: process.env.ALPACA_ALLOW_LIVE === 'true',
  baseUrl:
    process.env.ALPACA_BASE_URL?.trim() ||
    (process.env.ALPACA_PAPER === 'false' ? 'https://api.alpaca.markets' : 'https://paper-api.alpaca.markets'),
}

export function isBrokerEnabled(): boolean {
  if (BROKER_PROVIDER === 'alpaca') {
    return Boolean(ALPACA_CONFIG.apiKeyId && ALPACA_CONFIG.apiSecretKey)
  }
  return process.env.IBKR_ENABLED === 'true'
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
