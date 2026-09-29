export type DayHalt =
  | { halt: false; pnl: number }
  | { halt: true; reason: 'profit' | 'loss'; pnl: number }

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

export function sessionPnl(openNl: number | null, currentNl: number | null): number | null {
  if (!Number.isFinite(openNl) || !Number.isFinite(currentNl)) return null
  return Number((currentNl! - openNl!).toFixed(2))
}

const ticker = (symbol: string): string => symbol.toUpperCase().replace(/\s+/g, '.')

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
