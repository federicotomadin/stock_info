import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react'
import './App.css'
import {
  COUNTRY_LABELS,
  COUNTRY_SYMBOL_OVERRIDES,
  DEFAULT_SYMBOLS,
  INVESTMENT_GOALS,
  SORT_OPTIONS,
  TREND_LABELS,
  TREND_MEANINGS,
} from './models/constants'
import {
  BATCH_CONCURRENCY,
  CACHE_TTL_MS,
  DB_EXPIRES_AT,
  MANUAL_STOCKS_DEBOUNCE_MS,
  MARKET_SNAPSHOT_STORAGE_KEY,
  MAX_SYMBOLS,
  PAGE_SIZE,
  RENDER_POSTGRES_DOCS_URL,
  SCROLLER_PAGE_SIZE,
} from './constants/app'
import {
  cleanCompanyName,
  formatPercent,
  metricClass,
  numberOrFallback,
  parseSymbols,
  trendTooltip,
} from './utils'
import { horizonByTrendLabel, passesRiskProfileFilter, recommendationScore } from './analyzer'
import { TREND_ANALYSIS } from '../shared/trendAnalysisConstants'
import { stockInsight } from './riskProfile'
import { apiEndpoint, apiUrl, hasApiOriginConfigured } from './servicesAPI'
import { FundamentalsView } from './FundamentalsView'
import { TechnicalAnalysisView } from './TechnicalAnalysisView'
import type {
  AppMode,
  CompanyProfile,
  CountryLabel,
  EnrichedStock,
  InvestmentGoalId,
  MarketSnapshotCache,
  RiskProfile,
  SortDirection,
  SortMetric,
  StockQuote,
  TrendAnalysis,
  TrendLabel,
  TrendTone,
  UniverseItem,
  UniverseProgress,
} from './types/stock'

function readMarketSnapshotCache(): MarketSnapshotCache | null {
  try {
    const raw = localStorage.getItem(MARKET_SNAPSHOT_STORAGE_KEY)
    if (!raw) {
      return null
    }

    const cached = JSON.parse(raw)
    if (cached?.savedAt && Date.now() - cached.savedAt < CACHE_TTL_MS && cached.data?.length) {
      return cached
    }
  } catch {
    // Ignore corrupted cache.
  }

  return null
}

function writeMarketSnapshotCache(data: StockQuote[]) {
  try {
    localStorage.setItem(
      MARKET_SNAPSHOT_STORAGE_KEY,
      JSON.stringify({ data, savedAt: Date.now() })
    )
  } catch {
    // Quota exceeded or storage unavailable.
  }
}

interface ScreenerApiRow {
  symbol: string
  name: string
  exchange: string
  country: CountryLabel
  price: number
  updatedAt: string
  dayChange: number | null
  monthChange: number | null
  yearChange: number | null
  trend: TrendAnalysis
}

interface ScreenerSyncProgress {
  symbolsLoaded: number
  symbolsTotal: number
  updated: number
  unchanged: number
  failed: number
}

interface ScreenerSyncStatus {
  enabled: boolean
  syncing: boolean
  totalTickers: number
  totalQuotes: number
  lastSyncAt: string | null
  lastSyncUpdated: number | null
  lastSyncUnchanged: number | null
  lastSyncFailed: number | null
  progress: ScreenerSyncProgress | null
  error?: string
}

function formatDbExpiryLabel(isoDate: string): string | null {
  const parsed = new Date(`${isoDate}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return parsed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function mapScreenerRow(row: ScreenerApiRow): EnrichedStock {
  const quote = {
    symbol: row.symbol,
    price: row.price,
    updatedAt: row.updatedAt,
    dayChange: row.dayChange,
    monthChange: row.monthChange,
    yearChange: row.yearChange,
  }

  return {
    ...quote,
    name: row.name,
    exchange: row.exchange,
    country: row.country,
    // Recompute on client so profile picks follow latest Momentum rules even if DB labels are stale.
    trend: analyzeTrend(quote),
  }
}


function analyzeTrend(stock: StockQuote): TrendAnalysis {
  const hasMonth = Number.isFinite(stock.monthChange)
  const hasYear = Number.isFinite(stock.yearChange)

  // Newly IPO'd or otherwise no-history tickers: don't pretend it's a "downtrend".
  if (!hasMonth && !hasYear) {
    return {
      score: 0,
      label: 'Neutral',
      tone: 'neutral',
      detail: 'Recently listed — not enough historical data to compute a trend yet.',
    }
  }

  const { missingChangeFallback, yearScoreCap, scoreWeights, patterns } = TREND_ANALYSIS

  const day = numberOrFallback(stock.dayChange, missingChangeFallback)
  const month = numberOrFallback(stock.monthChange, missingChangeFallback)
  const year = numberOrFallback(stock.yearChange, missingChangeFallback)

  // Cap year in score so +1000% 1Y lottery tickets don't outrank real Momentum setups.
  const yearForScore = Math.max(Math.min(year, yearScoreCap), -yearScoreCap)
  let score = day * scoreWeights.day + month * scoreWeights.month + yearForScore * scoreWeights.year
  let label: TrendLabel = 'Neutral'
  let tone: TrendTone = 'neutral'
  let detail = 'No clear trend signal yet.'

  const {
    earlyBreakout,
    reversal,
    momentum,
    downtrend,
    pullbackBounce,
  } = patterns

  if (
    day > earlyBreakout.thresholds.dayMin &&
    month < earlyBreakout.thresholds.monthMax &&
    year < earlyBreakout.thresholds.yearMax
  ) {
    score += earlyBreakout.scoreAdjustment
    label = 'Early breakout'
    tone = 'speculative'
    detail = 'Strong daily move but unconfirmed by longer timeframes — high risk, could reverse.'
  } else if (
    day > reversal.thresholds.dayMin &&
    month > reversal.thresholds.monthMin &&
    year < reversal.thresholds.yearMax
  ) {
    score += reversal.scoreAdjustment
    label = 'Reversal'
    tone = 'caution'
    detail = 'Short-term momentum turning positive after weak year — watch for confirmation.'
  } else if (
    day > momentum.thresholds.dayMin &&
    month > momentum.thresholds.monthMin &&
    year > momentum.thresholds.yearMin
  ) {
    score += momentum.scoreAdjustment
    label = 'Momentum'
    tone = 'positive'
    detail = 'Confirmed uptrend across day, month and year — strongest signal.'
  } else if (
    day < downtrend.thresholds.dayMax &&
    month < downtrend.thresholds.monthMax &&
    year < downtrend.thresholds.yearMax
  ) {
    score += downtrend.scoreAdjustment
    label = 'Downtrend'
    tone = 'negative'
    detail = 'Weakness remains across all tracked windows — avoid.'
  } else if (
    day > pullbackBounce.thresholds.dayMin &&
    month < pullbackBounce.thresholds.monthMax &&
    year > pullbackBounce.thresholds.yearMin
  ) {
    score += pullbackBounce.scoreAdjustment
    label = 'Pullback bounce'
    tone = 'caution'
    detail = 'Positive day while month is in correction — timing uncertain.'
  }

  return { score, label, tone, detail }
}


function detectCountry(stock: Partial<EnrichedStock>): CountryLabel {
  const symbol = (stock.symbol ?? '').toUpperCase()
  const exchange = (stock.exchange ?? '').toUpperCase()
  const name = (stock.name ?? '').toUpperCase()

  if (COUNTRY_SYMBOL_OVERRIDES[symbol]) {
    return COUNTRY_SYMBOL_OVERRIDES[symbol]
  }

  if (
    name.includes('MERCADOLIBRE') ||
    name.includes('SATELLOGIC') ||
    name.includes('ARGENTINA') ||
    name.includes('ARGENTINE')
  ) {
    return 'Argentina'
  }

  if (name.includes('CHINA') || name.includes('CHINESE')) return 'China'
  if (name.includes('TAIWAN') || name.includes('TAIWANESE')) return 'Taiwan'
  if (name.includes('CANADA') || name.includes('CANADIAN')) return 'Canada'
  if (name.includes('BRAZIL') || name.includes('BRASIL')) return 'Brasil'
  if (name.includes('INDIA') || name.includes('INDIAN')) return 'India'
  if (name.includes('JAPAN') || name.includes('JAPANESE')) return 'Japon'
  if (name.includes('FRANCE') || name.includes('FRENCH')) return 'Francia'
  if (name.includes('UNITED KINGDOM') || name.includes('BRITISH')) return 'Reino Unido'

  if (
    exchange.includes('NASDAQ') ||
    exchange.includes('NYSE') ||
    exchange.includes('AMEX') ||
    exchange.includes('CBOE') ||
    exchange.includes('IEX')
  ) {
    return 'EE.UU'
  }

  if (symbol.endsWith('.BA')) return 'Argentina'
  if (symbol.endsWith('.TO') || symbol.endsWith('.V')) return 'Canada'
  if (symbol.endsWith('.TW') || symbol.endsWith('.TWO')) return 'Taiwan'
  if (symbol.endsWith('.SS') || symbol.endsWith('.SZ') || symbol.endsWith('.HK')) {
    return 'China'
  }
  if (symbol.endsWith('.L')) return 'Reino Unido'
  if (symbol.endsWith('.PA')) return 'Francia'
  if (symbol.endsWith('.SA')) return 'Brasil'
  if (symbol.endsWith('.NS') || symbol.endsWith('.BO')) return 'India'
  if (symbol.endsWith('.T')) return 'Japon'

  if (
    symbol.endsWith('.DE') ||
    symbol.endsWith('.MI') ||
    symbol.endsWith('.AS') ||
    symbol.endsWith('.MC') ||
    symbol.endsWith('.SW') ||
    symbol.endsWith('.ST') ||
    symbol.endsWith('.CO') ||
    symbol.endsWith('.HE') ||
    symbol.endsWith('.OL') ||
    symbol.endsWith('.VI') ||
    symbol.endsWith('.PR') ||
    symbol.endsWith('.WA') ||
    symbol.endsWith('.AT')
  ) {
    return 'Europa'
  }

  return 'EE.UU'
}

function readFundamentalsSymbolFromUrl(): string | null {
  if (typeof window === 'undefined') {
    return null
  }
  const params = new URLSearchParams(window.location.search)
  if (params.get('fundamentals') !== '1') {
    return null
  }
  const raw = params.get('symbol')?.trim().toUpperCase()
  return raw || null
}

function readTechnicalSymbolFromUrl(): string | null {
  if (typeof window === 'undefined') {
    return null
  }
  const params = new URLSearchParams(window.location.search)
  if (params.get('technical') !== '1') {
    return null
  }
  const raw = params.get('symbol')?.trim().toUpperCase()
  return raw || null
}

interface SortableHeaderProps {
  metricId: SortMetric
  label: string
  sortMetric: SortMetric
  sortDirection: SortDirection
  onSort: (metricId: SortMetric) => void
}

function SortableHeader({ metricId, label, sortMetric, sortDirection, onSort }: SortableHeaderProps) {
  const isActive = sortMetric === metricId
  const indicator = isActive ? (sortDirection === 'desc' ? '▼' : '▲') : ''
  const tooltip = isActive
    ? `Click para invertir (actual: ${sortDirection === 'desc' ? 'mayor a menor' : 'menor a mayor'})`
    : `Ordenar por ${label}`

  return (
    <button
      type="button"
      className={`sortable-header ${isActive ? 'active' : ''}`}
      onClick={() => onSort(metricId)}
      title={tooltip}
      aria-sort={
        isActive ? (sortDirection === 'desc' ? 'descending' : 'ascending') : 'none'
      }
    >
      <span>{label}</span>
      {indicator ? (
        <span className="sort-indicator" aria-hidden>
          {indicator}
        </span>
      ) : (
        <span className="sort-indicator-dim" aria-hidden>
          ↕
        </span>
      )}
    </button>
  )
}

interface TickerActionsMenuProps {
  symbol: string
  onOpenFundamentals: () => void
  onOpenTechnical: () => void
  className?: string
}

function TickerActionsMenu({
  symbol,
  onOpenFundamentals,
  onOpenTechnical,
  className = 'ticker-link',
}: TickerActionsMenuProps) {
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
  const containerRef = useRef<HTMLSpanElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const placeMenu = useCallback(() => {
    const anchor = containerRef.current
    const menu = menuRef.current
    if (!anchor || !menu) {
      return
    }

    const anchorRect = anchor.getBoundingClientRect()
    const menuHeight = menu.offsetHeight
    const menuWidth = menu.offsetWidth
    const spaceBelow = window.innerHeight - anchorRect.bottom - 8
    const openUp = spaceBelow < menuHeight && anchorRect.top > menuHeight + 8

    let left = anchorRect.left
    if (left + menuWidth > window.innerWidth - 16) {
      left = window.innerWidth - menuWidth - 16
    }
    left = Math.max(16, left)

    setMenuStyle({
      position: 'fixed',
      left,
      top: openUp ? anchorRect.top - menuHeight - 6 : anchorRect.bottom + 6,
      minWidth: Math.max(anchorRect.width, 220),
      zIndex: 1000,
    })
  }, [])

  useLayoutEffect(() => {
    if (!open) {
      return undefined
    }

    placeMenu()
    window.addEventListener('resize', placeMenu)
    window.addEventListener('scroll', placeMenu, true)
    return () => {
      window.removeEventListener('resize', placeMenu)
      window.removeEventListener('scroll', placeMenu, true)
    }
  }, [open, placeMenu])

  useEffect(() => {
    if (!open) {
      return undefined
    }

    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node
      if (
        containerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return
      }
      setOpen(false)
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  return (
    <span className="ticker-actions" ref={containerRef}>
      <button
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title="Abrir menú de análisis"
      >
        {symbol}
      </button>
      {open ? (
        <div
          ref={menuRef}
          className="ticker-menu ticker-menu-floating"
          role="menu"
          style={menuStyle}
        >
          <button
            type="button"
            role="menuitem"
            className="ticker-menu-item"
            onClick={() => {
              setOpen(false)
              onOpenFundamentals()
            }}
          >
            <span className="ticker-menu-item-title">Fundamentals</span>
            <span className="ticker-menu-item-subtitle">Métricas FMP (P/E, ROE, DCF…)</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="ticker-menu-item"
            onClick={() => {
              setOpen(false)
              onOpenTechnical()
            }}
          >
            <span className="ticker-menu-item-title">Análisis técnico</span>
            <span className="ticker-menu-item-subtitle">SMA, RSI, soportes y lectura AI</span>
          </button>
        </div>
      ) : null}
    </span>
  )
}


function App() {
  const [symbolsInput, setSymbolsInput] = useState(DEFAULT_SYMBOLS.join(', '))
  const [stocks, setStocks] = useState<StockQuote[]>([])
  const [marketUniverse, setMarketUniverse] = useState<UniverseItem[]>([])
  const [universeLoading, setUniverseLoading] = useState(false)
  const [universeSearch, setUniverseSearch] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [dbScreenerEnabled, setDbScreenerEnabled] = useState<boolean | null>(null)
  const [dbConnectionError, setDbConnectionError] = useState('')
  const [screenerSyncStatus, setScreenerSyncStatus] = useState<ScreenerSyncStatus | null>(null)
  const [screenerRows, setScreenerRows] = useState<EnrichedStock[]>([])
  const [screenerTotal, setScreenerTotal] = useState(0)
  const [screenerLoadingMore, setScreenerLoadingMore] = useState(false)
  const [screenerHasMore, setScreenerHasMore] = useState(false)
  const [recommendationPool, setRecommendationPool] = useState<EnrichedStock[]>([])
  const [fullMarketStocksLoading, setFullMarketStocksLoading] = useState(false)
  const [manualStocksLoading, setManualStocksLoading] = useState(false)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [universeError, setUniverseError] = useState('')
  const [universeProgress, setUniverseProgress] = useState({
    completed: 0,
    total: 0,
    symbolsLoaded: 0,
    symbolsTotal: 0,
  })
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
  const [companyProfiles, setCompanyProfiles] = useState<Record<string, CompanyProfile>>({})
  const [profileLoading, setProfileLoading] = useState(false)
  const [workspaceTab, setWorkspaceTab] = useState<'screener' | 'profile'>('screener')
  const [fundamentalsSymbol, setFundamentalsSymbol] = useState(() => readFundamentalsSymbolFromUrl())
  const [technicalSymbol, setTechnicalSymbol] = useState(() => readTechnicalSymbolFromUrl())
  const hasLoadedUniverseRef = useRef(false)
  const universeRequestIdRef = useRef(0)
  const manualStocksRequestIdRef = useRef(0)
  const profileRequestIdRef = useRef(0)
  const screenerRequestIdRef = useRef(0)
  const screenerOffsetRef = useRef(0)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)

  const useDbScreener = mode === 'universe' && dbScreenerEnabled === true

  const filteredUniverse = useMemo(() => {
    const query = universeSearch.trim().toUpperCase()
    if (!query) {
      return marketUniverse
    }

    return marketUniverse.filter(
      (item) =>
        item.symbol.includes(query) ||
        item.name.toUpperCase().includes(query) ||
        item.exchange.toUpperCase().includes(query)
    )
  }, [marketUniverse, universeSearch])

  const metadataBySymbol = useMemo(() => {
    return new Map(marketUniverse.map((item) => [item.symbol, item]))
  }, [marketUniverse])

  const sortedStocks = useMemo(() => {
    const sorted = stocks.map((stock) => {
      const enriched = {
        ...stock,
        ...(metadataBySymbol.get(stock.symbol) ?? {}),
      }

      return {
        ...enriched,
        trend: analyzeTrend(enriched),
        country: detectCountry(enriched),
      }
    })

    sorted.sort((a, b) => {
      const metricByKey: Record<SortMetric, 'trendScore' | 'dayChange' | 'monthChange' | 'yearChange'> = {
        trend: 'trendScore',
        day: 'dayChange',
        month: 'monthChange',
        year: 'yearChange',
      }

      const key = metricByKey[sortMetric]
      const valueA =
        key === 'trendScore'
          ? a.trend.score
          : (a[key] ?? Number.NEGATIVE_INFINITY)
      const valueB =
        key === 'trendScore'
          ? b.trend.score
          : (b[key] ?? Number.NEGATIVE_INFINITY)

      if (sortDirection === 'asc') {
        return valueA - valueB
      }

      return valueB - valueA
    })

    return sorted
  }, [metadataBySymbol, stocks, sortMetric, sortDirection])

  const trendFilteredStocks = useMemo(() => {
    if (trendFilter === 'all') {
      return sortedStocks
    }

    return sortedStocks.filter((stock) => stock.trend.label === trendFilter)
  }, [sortedStocks, trendFilter])

  const countryFilteredStocks = useMemo(() => {
    if (countryFilter === 'all') {
      return trendFilteredStocks
    }

    return trendFilteredStocks.filter((stock) => stock.country === countryFilter)
  }, [countryFilter, trendFilteredStocks])

  const riskProfile = useMemo(() => {
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

  const recommendedStocks = useMemo(() => {
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
      .sort((a, b) => b.recommendationScore - a.recommendationScore)
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

  useEffect(() => {
    if (workspaceTab !== 'profile') {
      return
    }

    const symbols = recommendedStocks.map((stock) => stock.symbol).filter(Boolean)
    if (!symbols.length) {
      setCompanyProfiles({})
      return
    }

    const requestId = profileRequestIdRef.current + 1
    profileRequestIdRef.current = requestId
    setProfileLoading(true)

    const endpoint = apiEndpoint('/api/company-profiles')
    endpoint.searchParams.set('symbols', symbols.join(','))

    void fetch(endpoint)
      .then((response) => response.json())
      .then((payload) => {
        if (profileRequestIdRef.current !== requestId) {
          return
        }

        const map: Record<string, CompanyProfile> = {}
        for (const item of (payload as { data?: CompanyProfile[] }).data ?? []) {
          map[item.symbol] = item
        }
        setCompanyProfiles(map)
      })
      .catch(() => {
        if (profileRequestIdRef.current !== requestId) {
          return
        }
        setCompanyProfiles({})
      })
      .finally(() => {
        if (profileRequestIdRef.current === requestId) {
          setProfileLoading(false)
        }
      })
  }, [recommendedStocks, workspaceTab])

  function handleSort(metricId: SortMetric) {
    if (sortMetric === metricId) {
      setSortDirection((current) => (current === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortMetric(metricId)
      setSortDirection('desc')
    }
    screenerOffsetRef.current = 0
  }

  function toggleGoal(goalId: InvestmentGoalId) {
    setInvestmentGoals((current) => {
      if (current.includes(goalId)) {
        if (current.length === 1) {
          return current
        }
        return current.filter((goal) => goal !== goalId)
      }
      return [...current, goalId]
    })
  }

  const displayStocks = useMemo(() => {
    if (mode === 'manual') {
      const requestedSymbols = new Set(parseSymbols(symbolsInput))
      if (!requestedSymbols.size) {
        return []
      }
      return countryFilteredStocks.filter((stock) =>
        requestedSymbols.has(String(stock.symbol ?? '').toUpperCase())
      )
    }

    if (useDbScreener) {
      return screenerRows
    }

    const start = (currentPage - 1) * PAGE_SIZE
    return countryFilteredStocks.slice(start, start + PAGE_SIZE)
  }, [
    countryFilteredStocks,
    currentPage,
    mode,
    screenerRows,
    symbolsInput,
    useDbScreener,
  ])

  const pagedStocks = displayStocks

  const totalPages = useMemo(() => {
    if (mode !== 'universe' || useDbScreener) {
      return 1
    }

    return Math.max(1, Math.ceil(countryFilteredStocks.length / PAGE_SIZE))
  }, [countryFilteredStocks.length, mode, useDbScreener])

  const fetchScreenerPage = useCallback(
    async ({ reset = false }: { reset?: boolean } = {}) => {
      if (!useDbScreener) {
        return
      }

      const requestId = screenerRequestIdRef.current + 1
      screenerRequestIdRef.current = requestId

      const offset = reset ? 0 : screenerOffsetRef.current

      if (reset) {
        setFullMarketStocksLoading(true)
        setScreenerRows([])
        setScreenerHasMore(false)
        screenerOffsetRef.current = 0
      } else {
        setScreenerLoadingMore(true)
      }

      setError('')

      try {
        const endpoint = apiEndpoint('/api/screener')
        endpoint.searchParams.set('offset', String(offset))
        endpoint.searchParams.set('limit', String(SCROLLER_PAGE_SIZE))
        endpoint.searchParams.set('sort', sortMetric)
        endpoint.searchParams.set('dir', sortDirection)
        if (universeSearch.trim()) {
          endpoint.searchParams.set('search', universeSearch.trim())
        }
        if (trendFilter !== 'all') {
          endpoint.searchParams.set('trend', trendFilter)
        }
        if (countryFilter !== 'all') {
          endpoint.searchParams.set('country', countryFilter)
        }

        const response = await fetch(endpoint)
        const payload = await response.json()

        if (screenerRequestIdRef.current !== requestId) {
          return
        }

        if (!response.ok) {
          setError(payload.error ?? 'Could not load screener data.')
          return
        }

        const mapped = ((payload.data ?? []) as ScreenerApiRow[]).map(mapScreenerRow)
        const total = Number(payload.total) || 0
        const nextOffset = offset + mapped.length

        screenerOffsetRef.current = nextOffset
        setScreenerTotal(total)
        setScreenerHasMore(nextOffset < total)
        setScreenerRows((current) => (reset ? mapped : [...current, ...mapped]))
      } catch {
        if (screenerRequestIdRef.current !== requestId) {
          return
        }
        setError('Could not load screener data from database.')
      } finally {
        if (screenerRequestIdRef.current === requestId) {
          setFullMarketStocksLoading(false)
          setScreenerLoadingMore(false)
        }
      }
    },
    [countryFilter, sortDirection, sortMetric, trendFilter, universeSearch, useDbScreener]
  )

  const loadUniverse = useCallback(async ({ force = false } = {}) => {
    setUniverseLoading(true)
    setUniverseError('')

    try {
      const url = force ? apiUrl('/api/universe?force=1') : apiUrl('/api/universe')

      console.log('URL', url)

      const response = await fetch(url)
      let payload: { error?: string; data?: UniverseItem[] } = {}
      try {
        payload = await response.json()
      } catch {
        payload = {}
      }

      if (!response.ok) {
        setUniverseError(payload.error ?? 'Could not load the market universe.')
        return
      }

      setMarketUniverse(payload.data ?? [])
    } catch {
      setUniverseError(
        import.meta.env.PROD && !hasApiOriginConfigured()
          ? 'No API URL in this build. Add repository secret or variable VITE_API_ORIGIN (your backend https URL, no trailing slash) and run the Deploy workflow again.'
          : 'Could not download the full stock list.'
      )
    } finally {
      setUniverseLoading(false)
    }
  }, [])

  const fetchManualStocks = useCallback(async (rawInput: string, { fromSubmit = false } = {}) => {
    const symbols = parseSymbols(rawInput)

    if (!symbols.length) {
      manualStocksRequestIdRef.current += 1
      setManualStocksLoading(false)
      if (fromSubmit) {
        setError('Enter at least one valid ticker. Example: AAPL, MSFT, NVDA')
      } else {
        setError('')
      }
      setStocks([])
      setWarning('')
      return
    }

    const requestId = manualStocksRequestIdRef.current + 1
    manualStocksRequestIdRef.current = requestId

    setManualStocksLoading(true)
    setStocks([])
    setError('')
    setWarning('')
    try {
      const endpoint = apiEndpoint('/api/stocks')
      endpoint.searchParams.set('symbols', symbols.join(','))
      const response = await fetch(endpoint)
      const payload = await response.json()

      if (manualStocksRequestIdRef.current !== requestId) {
        return
      }

      if (!response.ok) {
        setStocks([])
        setError(payload.error ?? 'Could not load stock data.')
        return
      }

      setStocks(payload.data ?? [])

      if (!payload.data?.length) {
        const firstFailure = payload.failed?.[0] ?? ''
        const isRateLimit = /\b429\b|rate limit|too many requests/i.test(firstFailure)
        setError(
          isRateLimit
            ? `Yahoo Finance is rate-limiting requests right now (HTTP 429). This is temporary. Try again in a minute, or set FMP_API_KEY in the server .env to avoid depending on Yahoo. Tickers requested: ${symbols.join(', ')}`
            : firstFailure ||
                'Could not load stock data. Please try again in a few seconds.'
        )
        return
      }

      if (payload.failed?.length) {
        setWarning('Partial results loaded. Some tickers may be invalid.')
      }
    } catch {
      if (manualStocksRequestIdRef.current !== requestId) {
        return
      }
      setStocks([])
      setError(
        import.meta.env.PROD && !hasApiOriginConfigured()
          ? 'No API URL in this build. Set VITE_API_ORIGIN (https backend URL) in GitHub and redeploy.'
          : 'Could not connect to local server. Run npm run dev to start frontend and API.'
      )
    } finally {
      if (manualStocksRequestIdRef.current === requestId) {
        setManualStocksLoading(false)
      }
    }
  }, [])

  const loadUniverseStocks = useCallback(async ({ forceRefresh = false } = {}) => {
    if (mode !== 'universe') {
      return
    }

    if (useDbScreener) {
      if (forceRefresh) {
        try {
          await fetch(apiUrl('/api/screener/sync?force=1'), { method: 'POST' })
        } catch {
          // Sync trigger is best-effort; screener still reads cached DB rows.
        }
      }
      await fetchScreenerPage({ reset: true })
      return
    }

    if (!filteredUniverse.length) {
      setStocks([])
      setUniverseProgress({ completed: 0, total: 0, symbolsLoaded: 0, symbolsTotal: 0 })
      return
    }

    const isFullUniverse = filteredUniverse.length === marketUniverse.length

    const applyCachedSnapshot = (cached: MarketSnapshotCache, sourceLabel: string) => {
      setStocks(cached.data)
      setUniverseProgress({
        completed: 1,
        total: 1,
        symbolsLoaded: cached.data.length,
        symbolsTotal: cached.data.length,
      })
      setWarning(
        `Showing cached data from ${sourceLabel} (${Math.round((Date.now() - cached.savedAt) / 1000)}s ago). Click "Refresh data" to update.`
      )
    }

    if (!forceRefresh && isFullUniverse) {
      const localCached = readMarketSnapshotCache()
      if (localCached) {
        applyCachedSnapshot(localCached, 'browser')
        return
      }

      try {
        const response = await fetch(apiUrl('/api/market-snapshot/latest'))
        const body = await response.json()
        if (response.ok && body.cache === 'hit' && body.data?.length) {
          const serverCached = { data: body.data, savedAt: body.savedAt }
          writeMarketSnapshotCache(body.data)
          applyCachedSnapshot(serverCached, 'server')
          return
        }
      } catch {
        // Fall through to SSE build.
      }
    }

    const requestId = universeRequestIdRef.current + 1
    universeRequestIdRef.current = requestId

    setFullMarketStocksLoading(true)
    setError('')
    setWarning('')
    setUniverseProgress({ completed: 0, total: 0, symbolsLoaded: 0, symbolsTotal: 0 })

    try {
      if (isFullUniverse) {
        const url = forceRefresh
          ? apiUrl('/api/market-snapshot?force=1')
          : apiUrl('/api/market-snapshot')
        const eventSource = new EventSource(url)
        const aggregatedStocks: StockQuote[] = []

        await new Promise<void>((resolve, reject) => {
          eventSource.onmessage = (event) => {
            if (universeRequestIdRef.current !== requestId) {
              eventSource.close()
              resolve()
              return
            }

            try {
              const msg = JSON.parse(event.data)

              if (msg.type === 'started') {
                setUniverseProgress((progress) => ({
                  ...progress,
                  total: msg.total,
                  symbolsTotal: msg.symbolsTotal,
                }))
              } else if (msg.type === 'progress') {
                aggregatedStocks.push(...(msg.batchData ?? []))
                setStocks([...aggregatedStocks])
                setUniverseProgress({
                  completed: msg.completed,
                  total: msg.total,
                  symbolsLoaded: msg.symbolsLoaded ?? aggregatedStocks.length,
                  symbolsTotal: msg.symbolsTotal ?? aggregatedStocks.length,
                })
              } else if (msg.type === 'done') {
                eventSource.close()
                setStocks([...aggregatedStocks])

                if (aggregatedStocks.length) {
                  writeMarketSnapshotCache(aggregatedStocks)
                }

                if (!aggregatedStocks.length) {
                  setError('Could not load stock data for the selected universe.')
                } else if (msg.failed > 0) {
                  setWarning(`Partial results loaded. Failed symbols: ${msg.failed}`)
                } else if (msg.cache === 'hit') {
                  setWarning('')
                }
                resolve()
              }
            } catch {
              eventSource.close()
              reject(new Error('Malformed SSE data'))
            }
          }

          eventSource.onerror = () => {
            eventSource.close()
            reject(new Error('SSE connection failed'))
          }
        })
      } else {
        const symbols = filteredUniverse.map((item) => item.symbol)
        const symbolBatches: string[][] = []
        for (let index = 0; index < symbols.length; index += MAX_SYMBOLS) {
          symbolBatches.push(symbols.slice(index, index + MAX_SYMBOLS))
        }

        setUniverseProgress({ completed: 0, total: symbolBatches.length, symbolsLoaded: 0, symbolsTotal: symbols.length })
        const aggregatedStocks: StockQuote[] = []
        const failedMessages: string[] = []

        let nextBatchIndex = 0

        async function runBatchWorker() {
          while (nextBatchIndex < symbolBatches.length) {
            if (universeRequestIdRef.current !== requestId) return

            const batch = symbolBatches[nextBatchIndex]
            nextBatchIndex += 1

            try {
              const endpoint = apiEndpoint('/api/stocks')
              endpoint.searchParams.set('symbols', batch.join(','))
              const response = await fetch(endpoint)
              const payload = await response.json()

              if (universeRequestIdRef.current !== requestId) return

              if (!response.ok) {
                failedMessages.push(payload.error ?? 'Could not load one stock batch.')
              } else {
                aggregatedStocks.push(...(payload.data ?? []))
                setStocks([...aggregatedStocks])
                if (payload.failed?.length) failedMessages.push(...payload.failed)
              }
            } catch {
              failedMessages.push('Could not load one stock batch.')
            } finally {
              if (universeRequestIdRef.current === requestId) {
                setUniverseProgress((progress) => ({
                  ...progress,
                  completed: progress.completed + 1,
                  symbolsLoaded: aggregatedStocks.length,
                  symbolsTotal: symbols.length,
                }))
              }
            }
          }
        }

        await Promise.all(
          Array.from({ length: Math.min(BATCH_CONCURRENCY, symbolBatches.length) }, () => runBatchWorker())
        )

        if (universeRequestIdRef.current !== requestId) return

        setStocks(aggregatedStocks)
        if (!aggregatedStocks.length) {
          setError(failedMessages[0] ?? 'Could not load stock data for the selected universe.')
        } else if (failedMessages.length) {
          setWarning(`Partial results loaded. Failed symbols: ${failedMessages.length}`)
        }
      }
    } catch {
      if (universeRequestIdRef.current !== requestId) return

      setStocks([])
      setError(
        import.meta.env.PROD && !hasApiOriginConfigured()
          ? 'No API URL in this build. Set VITE_API_ORIGIN (https backend URL) in GitHub and redeploy.'
          : 'Could not connect to local server. Run npm run dev to start frontend and API.'
      )
    } finally {
      if (universeRequestIdRef.current === requestId) {
        setFullMarketStocksLoading(false)
      }
    }
  }, [fetchScreenerPage, filteredUniverse, marketUniverse.length, mode, useDbScreener])

  useEffect(() => {
    if (hasLoadedUniverseRef.current) {
      return
    }

    hasLoadedUniverseRef.current = true
    void loadUniverse()
  }, [loadUniverse])

  useEffect(() => {
    let cancelled = false

    async function pollScreenerStatus() {
      try {
        const response = await fetch(apiUrl('/api/screener/status'))
        const body = (await response.json()) as ScreenerSyncStatus
        if (cancelled) {
          return
        }

        setDbScreenerEnabled(Boolean(body.enabled))
        if (!body.enabled) {
          setScreenerSyncStatus(null)
          setDbConnectionError(body.error?.trim() ?? '')
          return
        }

        setDbConnectionError('')
        setScreenerSyncStatus(body)

        if (body.progress) {
          setUniverseProgress({
            completed: body.progress.symbolsLoaded,
            total: body.progress.symbolsTotal,
            symbolsLoaded: body.progress.symbolsLoaded,
            symbolsTotal: body.progress.symbolsTotal,
          })
        }

        if (
          !body.syncing &&
          Number(body.totalQuotes) > 0 &&
          screenerRows.length === 0 &&
          mode === 'universe' &&
          body.enabled
        ) {
          void fetchScreenerPage({ reset: true })
        }
      } catch {
        if (!cancelled) {
          setDbScreenerEnabled(false)
          setScreenerSyncStatus(null)
          setDbConnectionError('Could not reach the API to check PostgreSQL status.')
        }
      }
    }

    void pollScreenerStatus()

    const intervalMs = dbScreenerEnabled === true ? 2500 : 8000
    const intervalId = window.setInterval(() => {
      void pollScreenerStatus()
    }, intervalMs)

    return () => {
      cancelled = true
      if (intervalId != null) {
        window.clearInterval(intervalId)
      }
    }
  }, [dbScreenerEnabled, fetchScreenerPage, mode, screenerRows.length])

  useEffect(() => {
    if (mode !== 'universe' || dbScreenerEnabled === null) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      if (dbScreenerEnabled) {
        void fetchScreenerPage({ reset: true })
      } else if (!dbConnectionError) {
        void loadUniverseStocks()
      }
    }, 350)

    return () => window.clearTimeout(timeoutId)
  }, [
    countryFilter,
    dbConnectionError,
    dbScreenerEnabled,
    fetchScreenerPage,
    loadUniverseStocks,
    mode,
    sortDirection,
    sortMetric,
    trendFilter,
    universeSearch,
  ])

  useEffect(() => {
    if (!useDbScreener) {
      setRecommendationPool([])
      return
    }

    // Pull actionable setups + strong movers. Client re-labels Momentum (DB labels can be stale).
    const requests: Array<{ sort: 'trend' | 'month' | 'day'; trend?: string }> = [
      { sort: 'month' },
      { sort: 'day' },
      { sort: 'trend' },
      { sort: 'month', trend: 'Momentum' },
      { sort: 'day', trend: 'Early breakout' },
      { sort: 'day', trend: 'Reversal' },
      { sort: 'month', trend: 'Pullback bounce' },
    ]

    void Promise.all(
      requests.map(async ({ sort, trend }) => {
        const endpoint = apiEndpoint('/api/screener')
        endpoint.searchParams.set('limit', '120')
        endpoint.searchParams.set('sort', sort)
        endpoint.searchParams.set('dir', 'desc')
        if (trend) {
          endpoint.searchParams.set('trend', trend)
        }
        const response = await fetch(endpoint)
        const payload = await response.json()
        return ((payload.data ?? []) as ScreenerApiRow[]).map(mapScreenerRow)
      }),
    )
      .then((chunks) => {
        const bySymbol = new Map<string, EnrichedStock>()
        for (const chunk of chunks) {
          for (const stock of chunk) {
            if (!bySymbol.has(stock.symbol)) {
              bySymbol.set(stock.symbol, stock)
            }
          }
        }
        setRecommendationPool([...bySymbol.values()])
      })
      .catch(() => setRecommendationPool([]))
  }, [screenerTotal, useDbScreener])

  useEffect(() => {
    if (!useDbScreener) {
      return
    }

    const node = loadMoreRef.current
    if (!node) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0]?.isIntersecting &&
          screenerHasMore &&
          !screenerLoadingMore &&
          !fullMarketStocksLoading
        ) {
          void fetchScreenerPage({ reset: false })
        }
      },
      { rootMargin: '240px' }
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [
    fetchScreenerPage,
    fullMarketStocksLoading,
    screenerHasMore,
    screenerLoadingMore,
    useDbScreener,
    screenerRows.length,
  ])

  useEffect(() => {
    if (mode !== 'manual') {
      setCurrentPage(1)
    }
  }, [universeSearch, mode, trendFilter, countryFilter])

  // Manual mode: cancel in-flight full-market fetches and clear bulk results.
  // Full market: cancel any in-flight manual quote request.
  useEffect(() => {
    if (mode === 'manual') {
      universeRequestIdRef.current += 1
      setFullMarketStocksLoading(false)
      setStocks([])
      setUniverseProgress({ completed: 0, total: 0, symbolsLoaded: 0, symbolsTotal: 0 })
      setError('')
      setWarning('')
    } else {
      manualStocksRequestIdRef.current += 1
      setManualStocksLoading(false)
    }
  }, [mode])

  useEffect(() => {
    if (mode !== 'manual') {
      return
    }

    const timeoutId = window.setTimeout(() => {
      void fetchManualStocks(symbolsInput, { fromSubmit: false })
    }, MANUAL_STOCKS_DEBOUNCE_MS)

    return () => window.clearTimeout(timeoutId)
  }, [mode, symbolsInput, fetchManualStocks])


  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void fetchManualStocks(symbolsInput, { fromSubmit: true })
  }

  function selectManualMode() {
    if (mode !== 'manual') {
      setSymbolsInput('')
    }
    setMode('manual')
  }

  const progressPercent =
    universeProgress.symbolsTotal > 0
      ? Math.round((universeProgress.symbolsLoaded / universeProgress.symbolsTotal) * 100)
      : universeProgress.total > 0
        ? Math.round((universeProgress.completed / universeProgress.total) * 100)
        : 0

  const dbExpiryLabel = DB_EXPIRES_AT ? formatDbExpiryLabel(DB_EXPIRES_AT) : null
  const showDbExpiryAlert =
    useDbScreener &&
    dbExpiryLabel != null &&
    new Date(`${DB_EXPIRES_AT}T23:59:59`).getTime() > Date.now()

  function handleBackToScreener() {
    setFundamentalsSymbol(null)
    setTechnicalSymbol(null)
    const url = new URL(window.location.href)
    url.searchParams.delete('fundamentals')
    url.searchParams.delete('technical')
    url.searchParams.delete('symbol')
    window.history.replaceState({}, '', `${url.pathname}${url.search}`)
  }

  function openFundamentalsInNewTab(symbol: string) {
    const url = new URL(window.location.href)
    url.searchParams.delete('technical')
    url.searchParams.set('fundamentals', '1')
    url.searchParams.set('symbol', symbol)
    window.open(url.toString(), '_blank', 'noopener,noreferrer')
  }

  function openTechnicalInNewTab(symbol: string) {
    const url = new URL(window.location.href)
    url.searchParams.delete('fundamentals')
    url.searchParams.set('technical', '1')
    url.searchParams.set('symbol', symbol)
    window.open(url.toString(), '_blank', 'noopener,noreferrer')
  }

  const screenerTableLoading =
    mode === 'manual'
      ? manualStocksLoading
      : useDbScreener
        ? fullMarketStocksLoading && screenerRows.length === 0
        : fullMarketStocksLoading

  if (technicalSymbol) {
    return (
      <>
        <header className="app-header">
          <div className="app-header-inner">
            <h1>
              Technical analysis
              <span className="app-header-subtitle">Indicadores + lectura AI</span>
            </h1>
          </div>
        </header>
        <main className="page">
          <TechnicalAnalysisView
            symbol={technicalSymbol}
            onBackToScreener={handleBackToScreener}
          />
        </main>
      </>
    )
  }

  if (fundamentalsSymbol) {
    return (
      <>
        <header className="app-header">
          <div className="app-header-inner">
            <h1>
              Fundamentals
              <span className="app-header-subtitle">Financial Modeling Prep</span>
            </h1>
          </div>
        </header>
        <main className="page">
          <FundamentalsView
            symbol={fundamentalsSymbol}
            onBackToScreener={handleBackToScreener}
          />
        </main>
      </>
    )
  }

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <h1>
            Stock Screener
            <span className="app-header-subtitle">Performance Dashboard</span>
          </h1>
        </div>
      </header>

      <main className="page">
        {(showDbExpiryAlert ||
          Boolean(dbConnectionError) ||
          (useDbScreener && screenerSyncStatus?.syncing)) ? (
          <div className="app-alerts">
            {dbConnectionError ? (
              <div className="app-alert warn" role="alert">
                <span className="app-alert-icon" aria-hidden="true">
                  !
                </span>
                <p>
                  PostgreSQL is not reachable, so the screener cannot read cached quotes. Start
                  it locally with <code>npm run db:up</code>, or in production recreate the Render
                  Postgres instance and set <code>DATABASE_URL</code> on the API.
                  <span className="app-alert-detail">{dbConnectionError}</span>
                </p>
              </div>
            ) : null}
            {showDbExpiryAlert ? (
              <div className="app-alert info" role="status">
                <span className="app-alert-icon" aria-hidden="true">
                  i
                </span>
                <p>
                  Your database will expire on <strong>{dbExpiryLabel}</strong>. The database will
                  be deleted unless you{' '}
                  <a href={RENDER_POSTGRES_DOCS_URL} target="_blank" rel="noreferrer noopener">
                    upgrade to a paid instance type
                  </a>
                  .
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Controls panel */}
        <section className="panel">
          <div className="panel-header">
            <span className="panel-title">Controls</span>
          </div>

          <div className="toolbar">
            <span className="toolbar-label">Mode:</span>
            <button
              type="button"
              className={`chip ${mode === 'universe' ? 'active' : ''}`}
              onClick={() => setMode('universe')}
            >
              Full market
            </button>
            <button
              type="button"
              className={`chip ${mode === 'manual' ? 'active' : ''}`}
              onClick={selectManualMode}
            >
              Manual tickers
            </button>
          </div>

          {mode === 'universe' ? (
            <>
              <form
                className="controls"
                onSubmit={(event) => {
                  event.preventDefault()
                  setCurrentPage(1)
                }}
              >
                <label htmlFor="universe-search">
                  Search market ({filteredUniverse.length} symbols)
                </label>
                <div className="input-row">
                  <input
                    id="universe-search"
                    className="input-field"
                    type="text"
                    value={universeSearch}
                    onChange={(event) => setUniverseSearch(event.target.value)}
                    placeholder="Example: Apple, AAPL, NYSE"
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void loadUniverse({ force: true })}
                    title="Vuelve a bajar el listing oficial de NASDAQ y NYSE (ignora cache server-side)"
                  >
                    {universeLoading ? 'Refreshing...' : 'Refresh universe'}
                  </button>
                </div>
              </form>

              <div className="pagination">
                {useDbScreener ? (
                  <span className="pagination-label">
                    Showing {screenerRows.length.toLocaleString()} of{' '}
                    {screenerTotal.toLocaleString()} · sorted in database
                  </span>
                ) : (
                  <>
                    <span className="pagination-label">
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={currentPage <= 1}
                      onClick={() => setCurrentPage((value) => Math.max(1, value - 1))}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={currentPage >= totalPages}
                      onClick={() =>
                        setCurrentPage((value) => Math.min(totalPages, value + 1))
                      }
                    >
                      Next
                    </button>
                  </>
                )}
              </div>
            </>
          ) : null}

          {mode === 'manual' ? (
            <form className="controls" onSubmit={handleSubmit}>
              <label htmlFor="symbols">Manual tickers (max {MAX_SYMBOLS})</label>
              <div className="input-row">
                <input
                  id="symbols"
                  className="input-field"
                  type="text"
                  value={symbolsInput}
                  onChange={(event) => setSymbolsInput(event.target.value)}
                  placeholder="AAPL, MSFT, NVDA"
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={manualStocksLoading}
                >
                  {manualStocksLoading ? 'Loading...' : 'Update'}
                </button>
              </div>
            </form>
          ) : null}

          <div className="toolbar">
            <span className="toolbar-label">Sort by:</span>
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.id}
                className={`chip ${sortMetric === option.id ? 'active' : ''}`}
                type="button"
                onClick={() => {
                  setSortMetric(option.id)
                  screenerOffsetRef.current = 0
                }}
              >
                {option.label}
              </button>
            ))}
            <button
              type="button"
              className="chip"
              onClick={() => {
                setSortDirection((current) => (current === 'desc' ? 'asc' : 'desc'))
                screenerOffsetRef.current = 0
              }}
            >
              {sortDirection === 'desc' ? 'Highest first' : 'Lowest first'}
            </button>
          </div>

          <div className="toolbar">
            <span className="toolbar-label">Trend:</span>
            <button
              type="button"
              className={`chip ${trendFilter === 'all' ? 'active' : ''}`}
              onClick={() => {
                setTrendFilter('all')
                screenerOffsetRef.current = 0
              }}
              title="Show all trend labels"
            >
              All
            </button>
            {TREND_LABELS.map((label) => (
              <button
                key={label}
                type="button"
                className={`chip ${trendFilter === label ? 'active' : ''}`}
                onClick={() => {
                  setTrendFilter(label)
                  screenerOffsetRef.current = 0
                }}
                title={TREND_MEANINGS[label]}
              >
                {label}
              </button>
            ))}
            <span
              className="trend-help"
              title={TREND_LABELS.map((label) => `${label}: ${TREND_MEANINGS[label]}`).join('\n')}
              aria-label="Trend labels meaning"
            >
              ?
            </span>
          </div>

          <div className="toolbar">
            <span className="toolbar-label">Country:</span>
            <button
              type="button"
              className={`chip ${countryFilter === 'all' ? 'active' : ''}`}
              onClick={() => {
                setCountryFilter('all')
                screenerOffsetRef.current = 0
              }}
              title="Show all countries"
            >
              All
            </button>
            {COUNTRY_LABELS.map((label) => (
              <button
                key={label}
                type="button"
                className={`chip ${countryFilter === label ? 'active' : ''}`}
                onClick={() => {
                  setCountryFilter(label)
                  screenerOffsetRef.current = 0
                }}
                title={`Filter by ${label}`}
              >
                {label}
              </button>
            ))}
          </div>

          {universeError ? <p className="status error">{universeError}</p> : null}
          {error ? <p className="status error">{error}</p> : null}
          {warning ? (
            <p className="status warning">
              {warning}
              {warning.includes('cached') ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm refresh-inline"
                  onClick={() => {
                    localStorage.removeItem(MARKET_SNAPSHOT_STORAGE_KEY)
                    void loadUniverseStocks({ forceRefresh: true })
                  }}
                >
                  Refresh data
                </button>
              ) : null}
            </p>
          ) : null}
          {mode === 'universe' && fullMarketStocksLoading ? (
            <>
              <p className="status loading">
                {universeProgress.symbolsTotal > 0
                  ? `Loading market data… ${universeProgress.symbolsLoaded.toLocaleString()} / ${universeProgress.symbolsTotal.toLocaleString()} symbols`
                  : 'Starting market data load…'}
                {universeProgress.symbolsTotal > 0 && universeProgress.total > 0
                  ? ` (${universeProgress.completed}/${universeProgress.total} batches)`
                  : ''}
              </p>
              {universeProgress.total > 0 || universeProgress.symbolsTotal > 0 ? (
              <div className="progress-bar-wrapper">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              ) : null}
            </>
          ) : null}
        </section>

        {/* Workspace panel */}
        <section className="panel workspace-panel">
          <div className="workspace-tabs" role="tablist" aria-label="Workspace tabs">
            <button
              type="button"
              role="tab"
              aria-selected={workspaceTab === 'screener'}
              className={`workspace-tab ${workspaceTab === 'screener' ? 'active' : ''}`}
              onClick={() => setWorkspaceTab('screener')}
            >
              Market Results
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={workspaceTab === 'profile'}
              className={`workspace-tab ${workspaceTab === 'profile' ? 'active' : ''}`}
              onClick={() => setWorkspaceTab('profile')}
            >
              Investor Profile
            </button>
          </div>

          {workspaceTab === 'profile' ? (
            <div className="profile-panel">
              <h2>Investor profile assistant</h2>
              <p className="subtitle">
                Answer a few questions and get stock ideas with a suggested horizon.
              </p>
              <div className="profile-grid">
                <fieldset>
                  <legend>Risk tolerance</legend>
                  <label>
                    <input
                      type="radio"
                      name="risk-tolerance"
                      checked={riskTolerance === 'low'}
                      onChange={() => setRiskTolerance('low')}
                    />
                    Low
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="risk-tolerance"
                      checked={riskTolerance === 'medium'}
                      onChange={() => setRiskTolerance('medium')}
                    />
                    Medium
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="risk-tolerance"
                      checked={riskTolerance === 'high'}
                      onChange={() => setRiskTolerance('high')}
                    />
                    High
                  </label>
                </fieldset>

                <fieldset>
                  <legend>Experience</legend>
                  <label>
                    <input
                      type="radio"
                      name="experience"
                      checked={investmentExperience === 'beginner'}
                      onChange={() => setInvestmentExperience('beginner')}
                    />
                    Beginner
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="experience"
                      checked={investmentExperience === 'intermediate'}
                      onChange={() => setInvestmentExperience('intermediate')}
                    />
                    Intermediate
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="experience"
                      checked={investmentExperience === 'advanced'}
                      onChange={() => setInvestmentExperience('advanced')}
                    />
                    Advanced
                  </label>
                </fieldset>

                <fieldset>
                  <legend>Preferred horizon</legend>
                  <label>
                    <input
                      type="radio"
                      name="preferred-horizon"
                      checked={investmentHorizon === 'short'}
                      onChange={() => setInvestmentHorizon('short')}
                    />
                    1-3 months
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="preferred-horizon"
                      checked={investmentHorizon === 'medium'}
                      onChange={() => setInvestmentHorizon('medium')}
                    />
                    3-12 months
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="preferred-horizon"
                      checked={investmentHorizon === 'long'}
                      onChange={() => setInvestmentHorizon('long')}
                    />
                    1+ years
                  </label>
                </fieldset>

                <fieldset>
                  <legend>Goals (multiple choice)</legend>
                  {INVESTMENT_GOALS.map((goal) => (
                    <label key={goal.id}>
                      <input
                        type="checkbox"
                        checked={investmentGoals.includes(goal.id)}
                        onChange={() => toggleGoal(goal.id)}
                      />
                      {goal.label}
                    </label>
                  ))}
                </fieldset>
              </div>

              <div className="profile-badge">
                Estimated profile: {riskProfile}
              </div>

              {profileLoading ? (
                <p className="status loading">Loading company fundamentals for recommendations...</p>
              ) : null}

              {recommendedStocks.length ? (
                <div className="recommendations">
                  {recommendedStocks.map((stock) => (
                    <article key={`rec-${stock.symbol}`} className="recommendation-card">
                      <div className="recommendation-content">
                        <div className="recommendation-main">
                          <h3>
                            <TickerActionsMenu
                              symbol={stock.symbol}
                              className="ticker-link ticker-link-inline"
                              onOpenFundamentals={() =>
                                openFundamentalsInNewTab(stock.symbol)
                              }
                              onOpenTechnical={() =>
                                openTechnicalInNewTab(stock.symbol)
                              }
                            />{' '}
                            <small>{cleanCompanyName(stock.name) ?? 'N/A'}</small>
                          </h3>
                          <div className="rec-meta">
                            <span className="rec-meta-item">
                              Trend: <strong>{stock.trend.label}</strong>
                            </span>
                            <span className="rec-divider" />
                            <span className="rec-meta-item">
                              Country: <strong>{stock.country}</strong>
                            </span>
                            <span className="rec-divider" />
                            <span className="rec-meta-item">
                              Horizon: <strong>{stock.recommendedHorizon}</strong>
                            </span>
                            <span className="rec-divider" />
                            <span className={`rec-meta-item ${metricClass(stock.yearChange)}`}>
                              1Y: <strong>{formatPercent(stock.yearChange)}</strong>
                            </span>
                          </div>
                          {companyProfiles[stock.symbol] ? (
                            <div className="rec-meta" style={{ marginTop: '0.25rem' }}>
                              {companyProfiles[stock.symbol].dataSource ? (
                                <span className="source-badge">
                                  {companyProfiles[stock.symbol].dataSource}
                                </span>
                              ) : null}
                              <span className="rec-meta-item">
                                Industry:{' '}
                                <strong>
                                  {companyProfiles[stock.symbol].industry ?? 'Unknown'}
                                </strong>
                              </span>
                              <span className="rec-divider" />
                              <span className="rec-meta-item">
                                Sector:{' '}
                                <strong>
                                  {companyProfiles[stock.symbol].sector ?? 'Unknown'}
                                </strong>
                              </span>
                              {companyProfiles[stock.symbol].yearsOperating ? (
                                <>
                                  <span className="rec-divider" />
                                  <span className="rec-meta-item">
                                    Years:{' '}
                                    <strong>
                                      {companyProfiles[stock.symbol].yearsOperating}+
                                    </strong>
                                  </span>
                                </>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        <p className="recommendation-note">
                          {stockInsight(stock, companyProfiles[stock.symbol])}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <p>No recommendations yet. Load stock data first.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="table-panel">
              <div className="table-panel-scroll">
              <table>
                <thead>
                  <tr>
                    <th className="col-ticker">Ticker</th>
                    <th className="col-name">Name</th>
                    <th className="col-exchange">Exchange</th>
                    <th className="col-price">Price</th>
                    <th className="col-metric">
                      <SortableHeader
                        metricId="day"
                        label="1D"
                        sortMetric={sortMetric}
                        sortDirection={sortDirection}
                        onSort={handleSort}
                      />
                    </th>
                    <th className="col-metric">
                      <SortableHeader
                        metricId="month"
                        label="1M"
                        sortMetric={sortMetric}
                        sortDirection={sortDirection}
                        onSort={handleSort}
                      />
                    </th>
                    <th className="col-metric">
                      <SortableHeader
                        metricId="year"
                        label="1Y"
                        sortMetric={sortMetric}
                        sortDirection={sortDirection}
                        onSort={handleSort}
                      />
                    </th>
                    <th className="col-trend">
                      <SortableHeader
                        metricId="trend"
                        label="Trend Signal"
                        sortMetric={sortMetric}
                        sortDirection={sortDirection}
                        onSort={handleSort}
                      />
                    </th>
                    <th className="col-date">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedStocks.map((stock) => (
                    <tr key={stock.symbol}>
                      <td className="col-ticker">
                        <TickerActionsMenu
                          symbol={stock.symbol}
                          onOpenFundamentals={() =>
                            openFundamentalsInNewTab(stock.symbol)
                          }
                          onOpenTechnical={() =>
                            openTechnicalInNewTab(stock.symbol)
                          }
                        />
                      </td>
                      <td
                        className="cell-name col-name"
                        title={cleanCompanyName(stock.name) ?? 'N/A'}
                      >
                        {cleanCompanyName(stock.name) ?? 'N/A'}
                      </td>
                      <td className="col-exchange" title={stock.exchange ?? 'N/A'}>
                        {stock.exchange ?? 'N/A'}
                      </td>
                      <td className="col-price">${stock.price.toFixed(2)}</td>
                      <td className={`col-metric ${metricClass(stock.dayChange)}`}>
                        {formatPercent(stock.dayChange)}
                      </td>
                      <td className={`col-metric ${metricClass(stock.monthChange)}`}>
                        {formatPercent(stock.monthChange)}
                      </td>
                      <td className={`col-metric ${metricClass(stock.yearChange)}`}>
                        {formatPercent(stock.yearChange)}
                      </td>
                      <td
                        className="col-trend"
                        title={trendTooltip(stock.trend.label, stock.trend.detail)}
                      >
                        <span className={`trend-chip ${stock.trend.tone}`}>
                          {stock.trend.label}
                        </span>
                      </td>
                      <td className="col-date">{stock.updatedAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>

              {!screenerTableLoading && !pagedStocks.length && !error ? (
                <div className="empty-state">
                  <p>No data to display.</p>
                </div>
              ) : null}
              {useDbScreener && screenerHasMore ? (
                <div ref={loadMoreRef} className="load-more-sentinel" aria-live="polite">
                  {screenerLoadingMore ? 'Loading more…' : 'Scroll for more rows'}
                </div>
              ) : null}
              {mode === 'universe' &&
              !useDbScreener &&
              fullMarketStocksLoading &&
              (trendFilter !== 'all' || countryFilter !== 'all') &&
              !pagedStocks.length &&
              sortedStocks.length > 0 ? (
                <p className="status warning">
                  No matching stocks yet with current filters ({trendFilter} /{' '}
                  {countryFilter}). Try &quot;All&quot; or wait until loading finishes.
                </p>
              ) : null}
            </div>
          )}
        </section>
      </main>
    </>
  )
}

export default App
