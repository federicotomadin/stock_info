import { queryScreener } from '../db/queries.js'
import { isDatabaseEnabled } from '../db/pool.js'
import { fetchTechnicalContext } from '../lib/supports.js'
import { ORDER_LIMITS } from '../broker/config.js'
import { buildBracketProposal, type BracketProposal } from '../broker/proposal.js'
import { toTickerSymbol } from '../broker/ibkr.js'
import { AGENT_CONFIG } from './config.js'

const ENTRY_LABELS = new Set(['Early breakout', 'Pullback bounce', 'Momentum', 'Reversal'])

const LABEL_BOOST: Record<string, number> = {
  'Early breakout': 12,
  'Pullback bounce': 10,
  Reversal: 8,
  Momentum: 4,
}

export function isEntryLabel(label: string): boolean {
  return ENTRY_LABELS.has(label)
}

export function rankScore(trendScore: number, trendLabel: string): number {
  return trendScore + (LABEL_BOOST[trendLabel] ?? 0)
}

export interface RankedCandidate {
  symbol: string
  name: string
  score: number
  trendLabel: string
  proposal?: BracketProposal
  rejected?: string
}

export async function findEntryCandidates(held: Set<string>): Promise<RankedCandidate[]> {
  if (!isDatabaseEnabled()) {
    throw new Error('El agente necesita DATABASE_URL para leer el screener.')
  }

  const { data } = await queryScreener({ sort: 'trend', dir: 'desc', limit: AGENT_CONFIG.scanLimit })
  const eligible = data
    .filter((row) => isEntryLabel(row.trendLabel) && !held.has(toTickerSymbol(row.symbol)))
    .sort((a, b) => rankScore(b.trendScore, b.trendLabel) - rankScore(a.trendScore, a.trendLabel))
    .slice(0, AGENT_CONFIG.supportFetchLimit)

  const ranked: RankedCandidate[] = []
  for (const row of eligible) {
    const { supports } = await fetchTechnicalContext(row.symbol)
    const built = buildBracketProposal(
      {
        symbol: row.symbol,
        price: row.price,
        budgetUsd: ORDER_LIMITS.maxOrderUsd,
        supports,
        trendLabel: row.trendLabel,
        yearChange: row.yearChange,
        monthChange: row.monthChange,
        rsi14: row.rsi14,
        marketCap: row.marketCap,
      },
      ORDER_LIMITS
    )

    ranked.push({
      symbol: row.symbol,
      name: row.name,
      score: rankScore(row.trendScore, row.trendLabel),
      trendLabel: row.trendLabel,
      ...('error' in built ? { rejected: built.error } : { proposal: built.proposal }),
    })
  }

  return ranked.sort((a, b) => {
    if (Boolean(a.proposal) !== Boolean(b.proposal)) return a.proposal ? -1 : 1
    return b.score - a.score
  })
}
