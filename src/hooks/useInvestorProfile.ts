import { useMemo } from 'react'
import { horizonByTrendLabel, passesRiskProfileFilter, recommendationScore } from '../analyzer'
import type { EnrichedStock, InvestmentGoalId, RiskProfile } from '../types/stock'

interface UseRiskProfileParams {
  riskTolerance: 'low' | 'medium' | 'high'
  investmentExperience: 'beginner' | 'intermediate' | 'advanced'
  investmentHorizon: 'short' | 'medium' | 'long'
  investmentGoals: InvestmentGoalId[]
}

export function useRiskProfile({
  riskTolerance,
  investmentExperience,
  investmentHorizon,
  investmentGoals,
}: UseRiskProfileParams): RiskProfile {
  return useMemo(() => {
    let score = 0

    const toleranceWeights = { low: -2, medium: 0, high: 2 }
    const experienceWeights = { beginner: -1, intermediate: 0, advanced: 1 }
    const horizonWeights = { short: -1, medium: 0, long: 1 }
    const goalWeights = {
      growth: 1,
      dividends: -1,
      stability: -1,
      value: 0.5,
    }

    score += toleranceWeights[riskTolerance] ?? 0
    score += experienceWeights[investmentExperience] ?? 0
    score += horizonWeights[investmentHorizon] ?? 0
    for (const goal of investmentGoals) {
      score += goalWeights[goal] ?? 0
    }

    if (score <= -1.5) {
      return 'Conservative'
    }
    if (score >= 2) {
      return 'Aggressive'
    }
    return 'Moderate'
  }, [investmentExperience, investmentGoals, investmentHorizon, riskTolerance])
}

interface UseRecommendedStocksParams {
  useDbScreener: boolean
  recommendationPool: EnrichedStock[]
  screenerRows: EnrichedStock[]
  countryFilteredStocks: EnrichedStock[]
  sortedStocks: EnrichedStock[]
  riskProfile: RiskProfile
  investmentGoals: InvestmentGoalId[]
  investmentHorizon: 'short' | 'medium' | 'long'
}

export function useRecommendedStocks({
  useDbScreener,
  recommendationPool,
  screenerRows,
  countryFilteredStocks,
  sortedStocks,
  riskProfile,
  investmentGoals,
  investmentHorizon,
}: UseRecommendedStocksParams): EnrichedStock[] {
  return useMemo(() => {
    const source = useDbScreener
      ? recommendationPool.length
        ? recommendationPool
        : screenerRows
      : countryFilteredStocks.length
        ? countryFilteredStocks
        : sortedStocks

    return source
      .filter((stock) => passesRiskProfileFilter(stock, riskProfile, investmentHorizon))
      .map((stock) => {
        const score = recommendationScore(stock, riskProfile, investmentGoals, investmentHorizon)
        return {
          ...stock,
          recommendationScore: score,
          recommendedHorizon: horizonByTrendLabel(stock.trend.label, riskProfile, investmentHorizon),
        }
      })
      .sort((a, b) => (b.recommendationScore ?? 0) - (a.recommendationScore ?? 0))
      .slice(0, 8)
  }, [
    countryFilteredStocks,
    investmentGoals,
    investmentHorizon,
    recommendationPool,
    riskProfile,
    screenerRows,
    sortedStocks,
    useDbScreener,
  ])
}
