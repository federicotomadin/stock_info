import { fetchYahooHeadlinesBrief } from './yahooHeadlines.js'

const MAX_LINES = 24

/** Headlines + day move for veto context (Node / Yahoo RSS — same stack as marketData). */
export async function fetchTickerNewsBrief(symbol: string, hours = 12): Promise<string | null> {
  const text = await fetchYahooHeadlinesBrief(symbol, hours)
  if (!text) return null
  const lines = text.split('\n').slice(0, MAX_LINES)
  return lines.join('\n')
}