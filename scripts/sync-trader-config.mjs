#!/usr/bin/env node
/**
 * Maps stock_info agent / IBKR env into trader/config.json for day-trader-skill Python tools.
 * Run from repo root: node scripts/sync-trader-config.mjs
 */
import { config as loadEnv } from 'dotenv'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
loadEnv({ path: resolve(root, '.env') })

const num = (name, fallback) => {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

const examplePath = resolve(root, 'tools/day-trader-skill/trader-budget/config.example.json')
const traderDir = resolve(root, 'trader')
const outPath = resolve(traderDir, 'config.json')

const example = JSON.parse(await readFile(examplePath, 'utf8'))

const budget =
  num('TRADER_BUDGET_USD', 0) ||
  num('AGENT_ACCOUNT_BUDGET_USD', 0) ||
  example.budget

const maxLoss =
  num('TRADER_MAX_LOSS_PER_TRADE_USD', 0) ||
  (num('AGENT_RISK_PCT', 1) / 100) * budget ||
  example.max_loss_per_trade_usd

const config = {
  ...example,
  budget,
  max_loss_per_trade_usd: Number(maxLoss.toFixed(2)),
  max_daily_loss_usd: num('AGENT_DAILY_LOSS_USD', example.max_daily_loss_usd),
  max_trades_per_day: num('IBKR_MAX_ORDERS_PER_DAY', example.max_trades_per_day),
  max_order_usd: num('IBKR_MAX_ORDER_USD', example.max_order_usd),
  min_reward_risk: num('IBKR_REWARD_RISK', example.min_reward_risk),
  paper: process.env.IBKR_ALLOW_LIVE !== 'true',
  broker: 'ibkr',
  sec_user_agent:
    process.env.SEC_USER_AGENT?.trim() ||
    process.env.TRADER_SEC_USER_AGENT?.trim() ||
    example.sec_user_agent,
}

await mkdir(traderDir, { recursive: true })
await writeFile(outPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
console.log(`Wrote ${outPath}`)