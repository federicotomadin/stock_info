import { getPool, isDatabaseEnabled } from '../db/pool.js'
import type { ExecutionFill } from '../broker/ibkr.js'

export interface SessionDay {
  day: string
  openNl: number | null
  closeNl: number | null
  reportSentAt: string | null
}

export interface StoredFill {
  execId: string
  symbol: string
  side: 'BUY' | 'SELL'
  quantity: number
  price: number
  sessionDate: string
}

async function tryRun<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  if (!isDatabaseEnabled()) return fallback
  try {
    return await run()
  } catch {
    return fallback
  }
}

const memoryDays = new Map<string, SessionDay>()
const memoryFills = new Map<string, StoredFill>()

export async function touchSessionDay(day: string, netLiquidation: number | null): Promise<SessionDay> {
  const existing = await getSessionDay(day)
  if (!existing) {
    const created: SessionDay = { day, openNl: netLiquidation, closeNl: netLiquidation, reportSentAt: null }
    memoryDays.set(day, created)
    await tryRun(async () => {
      await getPool().query(
        `INSERT INTO agent_session_days (day, open_nl, close_nl) VALUES ($1, $2, $2)
         ON CONFLICT (day) DO NOTHING`,
        [day, netLiquidation]
      )
    }, undefined)
    return (await getSessionDay(day)) ?? created
  }

  memoryDays.set(day, { ...existing, closeNl: netLiquidation ?? existing.closeNl })
  await tryRun(async () => {
    await getPool().query(`UPDATE agent_session_days SET close_nl = $2 WHERE day = $1`, [day, netLiquidation])
  }, undefined)
  return (await getSessionDay(day)) ?? existing
}

export async function getSessionDay(day: string): Promise<SessionDay | null> {
  const fromDb = await tryRun(async () => {
    const result = await getPool().query(
      `SELECT day::text AS day, open_nl, close_nl, report_sent_at FROM agent_session_days WHERE day = $1`,
      [day]
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      day: String(row.day).slice(0, 10),
      openNl: row.open_nl == null ? null : Number(row.open_nl),
      closeNl: row.close_nl == null ? null : Number(row.close_nl),
      reportSentAt: row.report_sent_at ? new Date(row.report_sent_at).toISOString() : null,
    } satisfies SessionDay
  }, undefined as SessionDay | null | undefined)

  if (fromDb !== undefined) return fromDb
  return memoryDays.get(day) ?? null
}

async function ensureSessionDayRow(day: string): Promise<void> {
  await tryRun(async () => {
    await getPool().query(
      `INSERT INTO agent_session_days (day) VALUES ($1::date) ON CONFLICT (day) DO NOTHING`,
      [day]
    )
  }, undefined)
}

/** True if this process may send the report (atomic; survives server restarts once committed). */
export async function tryClaimDailyReport(day: string): Promise<boolean> {
  const existing = await getSessionDay(day)
  if (existing?.reportSentAt) return false

  await ensureSessionDayRow(day)
  const claimed = await tryRun(async () => {
    const result = await getPool().query(
      `UPDATE agent_session_days
       SET report_sent_at = NOW()
       WHERE day = $1::date AND report_sent_at IS NULL
       RETURNING day`,
      [day]
    )
    return (result.rowCount ?? 0) > 0
  }, null as boolean | null)

  if (claimed === true) {
    const mem = memoryDays.get(day) ?? { day, openNl: null, closeNl: null, reportSentAt: null }
    mem.reportSentAt = new Date().toISOString()
    memoryDays.set(day, mem)
    return true
  }
  if (claimed === false) return false

  const mem = memoryDays.get(day)
  if (mem?.reportSentAt) return false
  memoryDays.set(day, {
    day,
    openNl: mem?.openNl ?? null,
    closeNl: mem?.closeNl ?? null,
    reportSentAt: new Date().toISOString(),
  })
  return true
}

export async function clearDailyReportClaim(day: string): Promise<void> {
  const mem = memoryDays.get(day)
  if (mem) mem.reportSentAt = null
  await tryRun(async () => {
    await getPool().query(`UPDATE agent_session_days SET report_sent_at = NULL WHERE day = $1::date`, [day])
  }, undefined)
}

export async function markReportSent(day: string): Promise<void> {
  const current = memoryDays.get(day) ?? { day, openNl: null, closeNl: null, reportSentAt: null }
  current.reportSentAt = new Date().toISOString()
  memoryDays.set(day, current)
  await ensureSessionDayRow(day)
  await tryRun(async () => {
    await getPool().query(
      `UPDATE agent_session_days SET report_sent_at = COALESCE(report_sent_at, NOW()) WHERE day = $1::date`,
      [day]
    )
  }, undefined)
}

export async function upsertFills(fills: ExecutionFill[]): Promise<void> {
  for (const fill of fills) {
    memoryFills.set(fill.execId, {
      execId: fill.execId,
      symbol: fill.symbol,
      side: fill.side,
      quantity: fill.quantity,
      price: fill.price,
      sessionDate: fill.sessionDate,
    })
  }
  if (!fills.length) return
  await tryRun(async () => {
    const pool = getPool()
    for (const fill of fills) {
      await pool.query(
        `INSERT INTO agent_fills (exec_id, symbol, side, quantity, price, session_date, executed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (exec_id) DO UPDATE SET
           symbol = EXCLUDED.symbol,
           side = EXCLUDED.side,
           quantity = EXCLUDED.quantity,
           price = EXCLUDED.price,
           session_date = EXCLUDED.session_date,
           executed_at = EXCLUDED.executed_at`,
        [fill.execId, fill.symbol, fill.side, fill.quantity, fill.price, fill.sessionDate, fill.time]
      )
    }
  }, undefined)
}

export async function listFillsForDay(day: string): Promise<StoredFill[]> {
  const fromDb = await tryRun(async () => {
    const result = await getPool().query(
      `SELECT exec_id, symbol, side, quantity, price, session_date::text AS session_date
       FROM agent_fills WHERE session_date = $1
       ORDER BY executed_at ASC, exec_id ASC`,
      [day]
    )
    return result.rows.map((row) => ({
      execId: String(row.exec_id),
      symbol: String(row.symbol),
      side: row.side === 'SELL' ? 'SELL' : 'BUY',
      quantity: Number(row.quantity),
      price: Number(row.price),
      sessionDate: String(row.session_date).slice(0, 10),
    })) satisfies StoredFill[]
  }, null as StoredFill[] | null)

  if (fromDb) return fromDb
  return [...memoryFills.values()].filter((fill) => fill.sessionDate === day)
}
