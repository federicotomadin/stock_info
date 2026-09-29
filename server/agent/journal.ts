import { isDatabaseEnabled, getPool } from '../db/pool.js'

export type AgentDecisionKind =
  | 'skip'
  | 'scan'
  | 'reject'
  | 'buy'
  | 'veto'
  | 'trail'
  | 'breakeven'
  | 'protect'
  | 'error'

export interface AgentDecision {
  id: number
  runId: number | null
  at: string
  kind: AgentDecisionKind
  symbol: string | null
  detail: string
}

export interface AgentTrade {
  id: number
  symbol: string
  status: string
  quantity: number
  entryPrice: number
  stopLoss: number
  takeProfit: number
  originalStop: number
  parentOrderId: number | null
  stopOrderId: number | null
  takeProfitOrderId: number | null
  reason: string | null
  openedAt: string
}

const memoryDecisions: AgentDecision[] = []
const memoryTrades: AgentTrade[] = []
let memoryRunId = 0
let memoryDecisionId = 0
let memoryTradeId = 0

async function tryQuery<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  if (!isDatabaseEnabled()) return fallback
  try {
    return await run()
  } catch {
    return fallback
  }
}

export async function startAgentRun(): Promise<number> {
  return tryQuery(async () => {
    const result = await getPool().query(`INSERT INTO agent_runs (status) VALUES ('running') RETURNING id`)
    return Number(result.rows[0].id)
  }, ++memoryRunId)
}

export async function finishAgentRun(runId: number, status: 'ok' | 'skipped' | 'error', summary: string): Promise<void> {
  if (!isDatabaseEnabled()) return
  try {
    await getPool().query(
      `UPDATE agent_runs SET finished_at = NOW(), status = $2, summary = $3 WHERE id = $1`,
      [runId, status, summary]
    )
  } catch {
    /* journal is best-effort */
  }
}

export async function logDecision(
  runId: number,
  kind: AgentDecisionKind,
  detail: string,
  symbol: string | null = null
): Promise<AgentDecision> {
  const row = await tryQuery(async () => {
    const result = await getPool().query(
      `INSERT INTO agent_decisions (run_id, kind, symbol, detail)
       VALUES ($1, $2, $3, $4)
       RETURNING id, run_id, at, kind, symbol, detail`,
      [runId, kind, symbol, detail]
    )
    const saved = result.rows[0]
    return {
      id: Number(saved.id),
      runId: saved.run_id == null ? null : Number(saved.run_id),
      at: new Date(saved.at).toISOString(),
      kind: saved.kind,
      symbol: saved.symbol,
      detail: saved.detail,
    } satisfies AgentDecision
  }, {
    id: ++memoryDecisionId,
    runId,
    at: new Date().toISOString(),
    kind,
    symbol,
    detail,
  })

  memoryDecisions.unshift(row)
  memoryDecisions.length = Math.min(memoryDecisions.length, 50)
  return row
}

export async function listDecisions(limit = 20): Promise<AgentDecision[]> {
  const fromDb = await tryQuery(async () => {
    const result = await getPool().query(
      `SELECT id, run_id, at, kind, symbol, detail
       FROM agent_decisions
       ORDER BY at DESC
       LIMIT $1`,
      [limit]
    )
    return result.rows.map((saved) => ({
      id: Number(saved.id),
      runId: saved.run_id == null ? null : Number(saved.run_id),
      at: new Date(saved.at).toISOString(),
      kind: saved.kind,
      symbol: saved.symbol,
      detail: saved.detail,
    }))
  }, null as AgentDecision[] | null)

  return fromDb ?? memoryDecisions.slice(0, limit)
}

export async function recordTrade(input: {
  symbol: string
  quantity: number
  entryPrice: number
  stopLoss: number
  takeProfit: number
  parentOrderId: number
  stopOrderId: number
  takeProfitOrderId: number
  reason: string
}): Promise<AgentTrade> {
  const row = await tryQuery(async () => {
    const result = await getPool().query(
      `INSERT INTO agent_trades (
         symbol, status, quantity, entry_price, stop_loss, take_profit, original_stop,
         parent_order_id, stop_order_id, take_profit_order_id, reason
       ) VALUES ($1, 'placed', $2, $3, $4, $5, $4, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.symbol,
        input.quantity,
        input.entryPrice,
        input.stopLoss,
        input.takeProfit,
        input.parentOrderId,
        input.stopOrderId,
        input.takeProfitOrderId,
        input.reason,
      ]
    )
    return mapTrade(result.rows[0])
  }, {
    id: ++memoryTradeId,
    symbol: input.symbol,
    status: 'placed',
    quantity: input.quantity,
    entryPrice: input.entryPrice,
    stopLoss: input.stopLoss,
    takeProfit: input.takeProfit,
    originalStop: input.stopLoss,
    parentOrderId: input.parentOrderId,
    stopOrderId: input.stopOrderId,
    takeProfitOrderId: input.takeProfitOrderId,
    reason: input.reason,
    openedAt: new Date().toISOString(),
  })

  memoryTrades.unshift(row)
  return row
}

export async function listOpenTrades(): Promise<AgentTrade[]> {
  const fromDb = await tryQuery(async () => {
    const result = await getPool().query(
      `SELECT * FROM agent_trades WHERE status IN ('placed', 'open') ORDER BY opened_at DESC`
    )
    return result.rows.map(mapTrade)
  }, null as AgentTrade[] | null)

  return fromDb ?? memoryTrades.filter((trade) => trade.status === 'placed' || trade.status === 'open')
}

export async function findOpenTrade(symbol: string): Promise<AgentTrade | null> {
  const trades = await listOpenTrades()
  return trades.find((trade) => trade.symbol.toUpperCase() === symbol.toUpperCase()) ?? null
}

export async function updateTradeStop(id: number, stopLoss: number, stopOrderId: number | null): Promise<void> {
  const memory = memoryTrades.find((trade) => trade.id === id)
  if (memory) {
    memory.stopLoss = stopLoss
    if (stopOrderId != null) memory.stopOrderId = stopOrderId
  }
  if (!isDatabaseEnabled()) return
  try {
    await getPool().query(
      `UPDATE agent_trades SET stop_loss = $2, stop_order_id = COALESCE($3, stop_order_id), status = 'open' WHERE id = $1`,
      [id, stopLoss, stopOrderId]
    )
  } catch {
    /* journal is best-effort */
  }
}

export async function listTradesOpenedOn(isoDate: string): Promise<AgentTrade[]> {
  const fromDb = await tryQuery(async () => {
    const result = await getPool().query(
      `SELECT * FROM agent_trades
       WHERE (timezone('America/New_York', opened_at))::date = $1::date
       ORDER BY opened_at ASC`,
      [isoDate]
    )
    return result.rows.map(mapTrade)
  }, null as AgentTrade[] | null)

  if (fromDb) return fromDb
  return memoryTrades.filter((trade) => trade.openedAt.slice(0, 10) === isoDate)
}

export async function expireOrphanTrades(held: Set<string>, workingBuys: Set<string>): Promise<void> {
  const open = await listOpenTrades()
  for (const trade of open) {
    const symbol = trade.symbol.toUpperCase().replace(/\s+/g, '.')
    if (held.has(symbol) || workingBuys.has(symbol)) continue
    const memory = memoryTrades.find((row) => row.id === trade.id)
    if (memory) memory.status = 'expired'
    if (!isDatabaseEnabled()) continue
    try {
      await getPool().query(
        `UPDATE agent_trades SET status = 'expired', closed_at = NOW(), exit_reason = 'expired' WHERE id = $1`,
        [trade.id]
      )
    } catch {
      /* journal is best-effort */
    }
  }
}

export async function countPlacedToday(): Promise<number> {
  return tryQuery(async () => {
    const result = await getPool().query(
      `SELECT COUNT(*)::int AS n FROM agent_trades WHERE opened_at >= CURRENT_DATE`
    )
    return Number(result.rows[0]?.n ?? 0)
  }, memoryTrades.filter((trade) => trade.openedAt.slice(0, 10) === new Date().toISOString().slice(0, 10)).length)
}

function mapTrade(row: Record<string, unknown>): AgentTrade {
  return {
    id: Number(row.id),
    symbol: String(row.symbol),
    status: String(row.status),
    quantity: Number(row.quantity),
    entryPrice: Number(row.entry_price),
    stopLoss: Number(row.stop_loss),
    takeProfit: Number(row.take_profit),
    originalStop: Number(row.original_stop),
    parentOrderId: row.parent_order_id == null ? null : Number(row.parent_order_id),
    stopOrderId: row.stop_order_id == null ? null : Number(row.stop_order_id),
    takeProfitOrderId: row.take_profit_order_id == null ? null : Number(row.take_profit_order_id),
    reason: row.reason == null ? null : String(row.reason),
    openedAt: new Date(String(row.opened_at)).toISOString(),
  }
}
