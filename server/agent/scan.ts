import { isBelowMinMarketCap, isOverextendedEntry } from '../../shared/entryGuards.js'
import { RECOMMENDATION_GUARDS } from '../../shared/trendAnalysisConstants.js'
import { queryScreener } from '../db/queries.js'
import { isDatabaseEnabled } from '../db/pool.js'
import { fetchTechnicalContext } from '../lib/supports.js'
import { fetchMarketCaps } from '../providers/nasdaqScreener.js'
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

export function resolveMarketCap(dbCap: number | null | undefined, nasdaqCap: number | undefined): number | null {
  if (Number.isFinite(dbCap)) return Number(dbCap)
  if (Number.isFinite(nasdaqCap)) return Number(nasdaqCap)
  return null
}

export interface AgentUniverseRow {
  symbol: string
  trendLabel: string
  marketCap: number | null
  yearChange: number | null
  monthChange: number | null
  rsi14: number | null
  price: number
}

/** Cheap filters applied before fetching OHLCV so the shortlist is not all microcaps. */
export function passesAgentUniverse(row: AgentUniverseRow, held: Set<string>): boolean {
  if (held.has(toTickerSymbol(row.symbol))) return false
  if (!isEntryLabel(row.trendLabel)) return false
  if (!Number.isFinite(row.price) || row.price < ORDER_LIMITS.minPrice) return false
  if (!Number.isFinite(row.yearChange)) return false
  if (!Number.isFinite(row.marketCap) || isBelowMinMarketCap(row.marketCap)) return false
  if (isOverextendedEntry({ label: row.trendLabel, rsi14: row.rsi14, monthChange: row.monthChange })) return false
  return true
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

  const nasdaqCaps = await fetchMarketCaps()
  const { data } = await queryScreener({
    sort: 'trend',
    dir: 'desc',
    limit: AGENT_CONFIG.scanLimit,
    minMarketCap: RECOMMENDATION_GUARDS.minMarketCapUsd,
  })

  const eligible = data
    .map((row) => ({
      ...row,
      marketCap: resolveMarketCap(row.marketCap, nasdaqCaps.get(row.symbol)),
    }))
    .filter((row) => passesAgentUniverse(row, held))
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
