import { nyWeekStart } from './marketHours.js'
import { listSessionDaysBetween } from './session.js'

export type DayHalt =
  | { halt: false; pnl: number }
  | { halt: true; reason: 'profit' | 'loss'; pnl: number }

export type WeekHalt = DayHalt

/** Stops new buys when the session P&L hits the daily target or the daily loss cap. */
export function evaluateDayHalt(pnl: number, profitUsd: number, lossUsd: number): DayHalt {
  if (Number.isFinite(pnl) && Number.isFinite(profitUsd) && pnl >= profitUsd) {
    return { halt: true, reason: 'profit', pnl }
  }
  if (Number.isFinite(pnl) && Number.isFinite(lossUsd) && pnl <= -lossUsd) {
    return { halt: true, reason: 'loss', pnl }
  }
  return { halt: false, pnl: Number.isFinite(pnl) ? pnl : 0 }
}

/** Same rules as the daily halt, applied to Mon–Sun (NY) cumulative P&L. */
export function evaluateWeekHalt(pnl: number, profitUsd: number, lossUsd: number): WeekHalt {
  return evaluateDayHalt(pnl, profitUsd, lossUsd)
}

export function sessionPnl(openNl: number | null, currentNl: number | null): number | null {
  if (!Number.isFinite(openNl) || !Number.isFinite(currentNl)) return null
  return Number((currentNl! - openNl!).toFixed(2))
}

const ticker = (symbol: string): string => symbol.toUpperCase().replace(/\s+/g, '.')

function dayPnlForSession(day: string, today: string, currentNl: number | null, row: { openNl: number | null; closeNl: number | null }): number | null {
  if (day === today) {
    return sessionPnl(row.openNl, currentNl ?? row.closeNl)
  }
  return sessionPnl(row.openNl, row.closeNl)
}

/** Sum of session P&L from NY Monday through `today` (inclusive). */
export async function computeWeeklyPnl(today: string, currentNl: number | null): Promise<number | null> {
  const weekStart = nyWeekStart(today)
  const days = await listSessionDaysBetween(weekStart, today)
  if (!days.length && currentNl == null) return null

  let total = 0
  let saw = false
  for (const row of days) {
    const pnl = dayPnlForSession(row.day, today, currentNl, row)
    if (pnl == null) continue
    total += pnl
    saw = true
  }
  if (!saw && currentNl == null) return null
  return Number(total.toFixed(2))
}

/** Daily cap counts fills still on the book or working buys, not expired DAY orders like BE. */
export function countLiveEntriesToday(
  submitted: string[],
  held: Set<string>,
  workingBuys: Set<string>
): number {
  const live = new Set<string>()
  for (const symbol of submitted.map(ticker)) {
    if (held.has(symbol) || workingBuys.has(symbol)) live.add(symbol)
  }
  for (const symbol of workingBuys) live.add(ticker(symbol))
  return live.size
}
