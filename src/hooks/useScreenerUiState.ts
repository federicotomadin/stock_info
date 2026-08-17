import { useState } from 'react'
import { DEFAULT_SYMBOLS } from '../models/constants'
import type {
  AppMode,
  CountryLabel,
  InvestmentGoalId,
  SortDirection,
  SortMetric,
  StockQuote,
  TrendLabel,
  UniverseProgress,
} from '../types/stock'

const EMPTY_PROGRESS: UniverseProgress = { completed: 0, total: 0, symbolsLoaded: 0, symbolsTotal: 0 }

/** Owns every piece of controlled UI state for the screener page (mode, filters, sort, investor
 * profile inputs). Kept separate from data-fetching hooks so App.tsx stays a composition root. */
export function useScreenerUiState() {
  const [symbolsInput, setSymbolsInput] = useState(DEFAULT_SYMBOLS.join(', '))
  const [stocks, setStocks] = useState<StockQuote[]>([])
  const [universeSearch, setUniverseSearch] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [universeProgress, setUniverseProgress] = useState<UniverseProgress>(EMPTY_PROGRESS)
  const [mode, setMode] = useState<AppMode>('universe')
  const [sortMetric, setSortMetric] = useState<SortMetric>('year')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [trendFilter, setTrendFilter] = useState<TrendLabel | 'all'>('all')
  const [countryFilter, setCountryFilter] = useState<CountryLabel | 'all'>('all')
  const [riskTolerance, setRiskTolerance] = useState<'low' | 'medium' | 'high'>('medium')
  const [investmentExperience, setInvestmentExperience] = useState<
    'beginner' | 'intermediate' | 'advanced'
  >('intermediate')
  const [investmentHorizon, setInvestmentHorizon] = useState<'short' | 'medium' | 'long'>('medium')
  const [investmentGoals, setInvestmentGoals] = useState<InvestmentGoalId[]>(['growth'])
  const [workspaceTab, setWorkspaceTab] = useState<'screener' | 'profile'>('screener')

  return {
    symbolsInput,
    setSymbolsInput,
    stocks,
    setStocks,
    universeSearch,
    setUniverseSearch,
    currentPage,
    setCurrentPage,
    error,
    setError,
    warning,
    setWarning,
    universeProgress,
    setUniverseProgress,
    mode,
    setMode,
    sortMetric,
    setSortMetric,
    sortDirection,
    setSortDirection,
    trendFilter,
    setTrendFilter,
    countryFilter,
    setCountryFilter,
    riskTolerance,
    setRiskTolerance,
    investmentExperience,
    setInvestmentExperience,
    investmentHorizon,
    setInvestmentHorizon,
    investmentGoals,
    setInvestmentGoals,
    workspaceTab,
    setWorkspaceTab,
  }
}
