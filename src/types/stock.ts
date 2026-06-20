export type TrendLabel =
  | 'Early breakout'
  | 'Reversal'
  | 'Momentum'
  | 'Pullback bounce'
  | 'Downtrend'
  | 'Neutral'

export type TrendTone = 'positive' | 'negative' | 'neutral' | 'caution' | 'speculative'

export interface TrendAnalysis {
  score: number
  label: TrendLabel
  tone: TrendTone
  detail: string
}

export interface StockQuote {
  symbol: string
  price: number
  updatedAt: string
  dayChange: number | null
  monthChange: number | null
  yearChange: number | null
}

export interface UniverseItem {
  symbol: string
  name: string
  exchange: string
}

export interface EnrichedStock extends StockQuote {
  name?: string
  exchange?: string
  trend: TrendAnalysis
  country: string
  recommendationScore?: number
  recommendedHorizon?: string
}

export type SortMetric = 'trend' | 'day' | 'month' | 'year'
export type SortDirection = 'asc' | 'desc'
export type AppMode = 'universe' | 'manual'
export type RiskProfile = 'Conservative' | 'Moderate' | 'Aggressive'
export type InvestmentGoalId = 'growth' | 'dividends' | 'stability' | 'value'
export type CountryLabel =
  | 'Argentina'
  | 'EE.UU'
  | 'Europa'
  | 'China'
  | 'Reino Unido'
  | 'Canada'
  | 'Francia'
  | 'Brasil'
  | 'India'
  | 'Japon'
  | 'Taiwan'

export interface CompanyProfile {
  symbol: string
  sector?: string | null
  industry?: string | null
  businessSummary?: string | null
  dataSource?: string
  yearsOperating?: number
  yearsSource?: 'founded' | 'listed'
  foundedYear?: number
  listedYear?: number
}

export interface UniverseProgress {
  completed: number
  total: number
  symbolsLoaded: number
  symbolsTotal: number
}

export interface MarketSnapshotCache {
  data: StockQuote[]
  savedAt: number
}
