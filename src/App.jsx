import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const DEFAULT_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'TSLA']
const PAGE_SIZE = 20
const MAX_SYMBOLS = 120
const BATCH_CONCURRENCY = 3

const SORT_OPTIONS = [
  { id: 'trend', label: 'Trend' },
  { id: 'day', label: '1D' },
  { id: 'month', label: '1M' },
  { id: 'year', label: '1Y' },
]
const TREND_LABELS = [
  'Early breakout',
  'Reversal',
  'Momentum',
  'Pullback bounce',
  'Downtrend',
  'Neutral',
]
const COUNTRY_LABELS = [
  'Argentina',
  'EE.UU',
  'Europa',
  'China',
  'Reino Unido',
  'Canada',
  'Francia',
  'Brasil',
  'India',
  'Japon',
  'Taiwan',
]
const INVESTMENT_GOALS = [
  { id: 'growth', label: 'Growth' },
  { id: 'dividends', label: 'Dividends' },
  { id: 'stability', label: 'Stability' },
  { id: 'value', label: 'Value opportunities' },
]
const COUNTRY_SYMBOL_OVERRIDES = {
  MELI: 'Argentina',
  GLOB: 'Argentina',
  CRESY: 'Argentina',
  YPF: 'Argentina',
  TS: 'Europa',
  SHEL: 'Europa',
  NVO: 'Europa',
  TTE: 'Europa',
  BABA: 'China',
  BIDU: 'China',
  JD: 'China',
  PDD: 'China',
  TSM: 'Taiwan',
  BTI: 'Reino Unido',
  AZN: 'Reino Unido',
  HSBC: 'Reino Unido',
  LYG: 'Reino Unido',
  SHOP: 'Canada',
  RY: 'Canada',
  TD: 'Canada',
  BMO: 'Canada',
  ENB: 'Canada',
  CNI: 'Canada',
  CNQ: 'Canada',
  SU: 'Canada',
  TRP: 'Canada',
  BCE: 'Canada',
  TU: 'Canada',
  AEM: 'Canada',
  WCN: 'Canada',
  CP: 'Canada',
  CNR: 'Canada',
  EQNR: 'Europa',
  ERJ: 'Brasil',
  VALE: 'Brasil',
  ITUB: 'Brasil',
  NU: 'Brasil',
  HDB: 'India',
  IBN: 'India',
  INFY: 'India',
  WIT: 'India',
  NTDOY: 'Japon',
  SONY: 'Japon',
  TM: 'Japon',
  HMC: 'Japon',
}
const TREND_MEANINGS = {
  'Early breakout':
    'Strong daily move with low monthly/yearly extension. Possible early-stage run.',
  Reversal:
    'Short-term momentum turning positive after weak long-term performance.',
  Momentum:
    'Positive day/month/year trend that still appears active.',
  'Pullback bounce':
    'Price bouncing in the short term during a broader monthly pullback.',
  Downtrend:
    'Negative direction across day, month, and year windows.',
  Neutral:
    'No clear directional edge from current day/month/year signals.',
}

function parseSymbols(rawInput) {
  const parsed = rawInput
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)

  return Array.from(new Set(parsed)).slice(0, MAX_SYMBOLS)
}

function formatPercent(value) {
  if (value === null || Number.isNaN(value)) {
    return 'N/A'
  }

  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

function metricClass(value) {
  if (value === null || Number.isNaN(value)) {
    return ''
  }

  if (value > 0) {
    return 'positive'
  }

  if (value < 0) {
    return 'negative'
  }

  return 'neutral'
}

function numberOrFallback(value, fallback = 0) {
  if (value === null || Number.isNaN(value)) {
    return fallback
  }

  return value
}

function analyzeTrend(stock) {
  const day = numberOrFallback(stock.dayChange, -100)
  const month = numberOrFallback(stock.monthChange, -100)
  const year = numberOrFallback(stock.yearChange, -100)
  const acceleration = day - month / 21

  let score = day * 0.55 + month * 0.35 + year * 0.1
  let label = 'Neutral'
  let tone = 'neutral'
  let detail = 'No clear trend signal yet.'

  if (day > 1.1 && month < 4 && year < 18) {
    score += 10
    label = 'Early breakout'
    tone = 'positive'
    detail = 'Strong daily move with low long-term saturation.'
  } else if (day > 0.4 && month > 0 && year < 0) {
    score += 14
    label = 'Reversal'
    tone = 'positive'
    detail = 'Short-term momentum turning positive after weak year.'
  } else if (day > 0 && month > 6 && year > 12 && acceleration > -0.8) {
    score += 5
    label = 'Momentum'
    tone = 'positive'
    detail = 'Uptrend still active across day, month and year.'
  } else if (day < 0 && month < 0 && year < 0) {
    score -= 8
    label = 'Downtrend'
    tone = 'negative'
    detail = 'Weakness remains across all tracked windows.'
  } else if (day > 0 && month < 0 && year > 0) {
    score += 3
    label = 'Pullback bounce'
    tone = 'neutral'
    detail = 'Positive day while month is in correction.'
  }

  return { score, label, tone, detail }
}

function trendTooltip(label, detail) {
  return `${label}: ${TREND_MEANINGS[label] ?? detail}`
}

function cleanCompanyName(name) {
  if (!name) {
    return null
  }

  return name
    .replace(/\s*-\s*Common Stock$/i, '')
    .replace(/\s*Common Stock$/i, '')
    .trim()
}

function detectCountry(stock) {
  const symbol = (stock.symbol ?? '').toUpperCase()
  const exchange = (stock.exchange ?? '').toUpperCase()
  const name = (stock.name ?? '').toUpperCase()

  if (COUNTRY_SYMBOL_OVERRIDES[symbol]) {
    return COUNTRY_SYMBOL_OVERRIDES[symbol]
  }

  if (
    name.includes('MERCADOLIBRE') ||
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

function horizonByTrendLabel(label, profile) {
  if (label === 'Early breakout' || label === 'Reversal') {
    return profile === 'Aggressive' ? '1-3 months' : '3-6 months'
  }
  if (label === 'Momentum') {
    return profile === 'Conservative' ? '6-12 months' : '3-9 months'
  }
  if (label === 'Pullback bounce') {
    return profile === 'Conservative' ? '3-6 months' : '1-3 months'
  }
  if (label === 'Neutral') {
    return '6-12 months'
  }
  return 'Watchlist (avoid entry for now)'
}

function recommendationScore(stock, profile, goals) {
  const day = numberOrFallback(stock.dayChange, -100)
  const month = numberOrFallback(stock.monthChange, -100)
  const year = numberOrFallback(stock.yearChange, -100)
  const trendScore = stock.trend?.score ?? 0
  const trendLabel = stock.trend?.label ?? 'Neutral'

  let score = trendScore

  if (profile === 'Conservative') {
    score += month * 0.6 + year * 0.8 - Math.abs(day) * 0.5
    if (trendLabel === 'Downtrend') score -= 12
    if (trendLabel === 'Momentum') score += 4
  } else if (profile === 'Aggressive') {
    score += day * 1.2 + month * 0.45 + year * 0.2
    if (trendLabel === 'Early breakout' || trendLabel === 'Reversal') score += 6
    if (trendLabel === 'Downtrend') score -= 6
  } else {
    score += day * 0.55 + month * 0.65 + year * 0.45
    if (trendLabel === 'Momentum' || trendLabel === 'Reversal') score += 3
  }

  if (goals.includes('dividends')) {
    score += year > 0 ? 3 : -2
    score -= Math.abs(day) * 0.25
  }
  if (goals.includes('stability')) {
    score -= Math.abs(day) * 0.4
    score += month > 0 ? 2 : -1
  }
  if (goals.includes('growth')) {
    score += month * 0.35 + year * 0.35
  }
  if (goals.includes('value')) {
    if (trendLabel === 'Reversal' || trendLabel === 'Pullback bounce') {
      score += 4
    }
  }

  return score
}

function App() {
  const [symbolsInput, setSymbolsInput] = useState(DEFAULT_SYMBOLS.join(', '))
  const [stocks, setStocks] = useState([])
  const [marketUniverse, setMarketUniverse] = useState([])
  const [universeLoading, setUniverseLoading] = useState(false)
  const [universeSearch, setUniverseSearch] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [universeError, setUniverseError] = useState('')
  const [universeProgress, setUniverseProgress] = useState({ completed: 0, total: 0 })
  const [mode, setMode] = useState('universe')
  const [sortMetric, setSortMetric] = useState('year')
  const [sortDirection, setSortDirection] = useState('desc')
  const [trendFilter, setTrendFilter] = useState('all')
  const [countryFilter, setCountryFilter] = useState('all')
  const [riskTolerance, setRiskTolerance] = useState('medium')
  const [investmentExperience, setInvestmentExperience] = useState('intermediate')
  const [investmentHorizon, setInvestmentHorizon] = useState('medium')
  const [investmentGoals, setInvestmentGoals] = useState(['growth'])
  const hasLoadedUniverseRef = useRef(false)
  const universeRequestIdRef = useRef(0)

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
      const metricByKey = {
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
    const source = countryFilteredStocks.length ? countryFilteredStocks : sortedStocks

    return source
      .filter((stock) => stock.trend?.label !== 'Downtrend')
      .map((stock) => {
        const score = recommendationScore(stock, riskProfile, investmentGoals)
        return {
          ...stock,
          recommendationScore: score,
          recommendedHorizon: horizonByTrendLabel(stock.trend.label, riskProfile),
        }
      })
      .sort((a, b) => b.recommendationScore - a.recommendationScore)
      .slice(0, 8)
  }, [countryFilteredStocks, investmentGoals, riskProfile, sortedStocks])

  function toggleGoal(goalId) {
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

  const pagedStocks = useMemo(() => {
    if (mode !== 'universe') {
      return countryFilteredStocks
    }

    const start = (currentPage - 1) * PAGE_SIZE
    return countryFilteredStocks.slice(start, start + PAGE_SIZE)
  }, [countryFilteredStocks, currentPage, mode])

  const totalPages = useMemo(() => {
    if (mode !== 'universe') {
      return 1
    }

    return Math.max(1, Math.ceil(countryFilteredStocks.length / PAGE_SIZE))
  }, [countryFilteredStocks.length, mode])

  const loadUniverse = useCallback(async () => {
    setUniverseLoading(true)
    setUniverseError('')

    try {
      const response = await fetch('/api/universe')
      const payload = await response.json()

      if (!response.ok) {
        setUniverseError(payload.error ?? 'Could not load the market universe.')
        return
      }

      setMarketUniverse(payload.data ?? [])
    } catch {
      setUniverseError('Could not download the full stock list.')
    } finally {
      setUniverseLoading(false)
    }
  }, [])

  const loadStocks = useCallback(
    async (customInput) => {
      const symbols = parseSymbols(customInput)

      if (!symbols.length) {
        setError('Enter at least one valid ticker. Example: AAPL, MSFT, NVDA')
        setStocks([])
        return
      }

      setLoading(true)
      setError('')
      setWarning('')
      try {
        const endpoint = new URL('/api/stocks', window.location.origin)
        endpoint.searchParams.set('symbols', symbols.join(','))
        const response = await fetch(endpoint)
        const payload = await response.json()

        if (!response.ok) {
          setStocks([])
          setError(payload.error ?? 'Could not load stock data.')
          return
        }

        setStocks(payload.data ?? [])

        if (!payload.data?.length) {
          setError(
            payload.failed?.[0] ??
              'Could not load stock data. Please try again in a few seconds.'
          )
          return
        }

        if (payload.failed?.length) {
          setWarning('Partial results loaded. Some tickers may be invalid.')
        }
      } catch {
        setStocks([])
        setError(
          'Could not connect to local server. Run npm run dev to start frontend and API.'
        )
      } finally {
        setLoading(false)
      }
    },
    []
  )

  const loadUniverseStocks = useCallback(async () => {
    if (mode !== 'universe') {
      return
    }

    if (!filteredUniverse.length) {
      setStocks([])
      setUniverseProgress({ completed: 0, total: 0 })
      return
    }

    const requestId = universeRequestIdRef.current + 1
    universeRequestIdRef.current = requestId

    const symbols = filteredUniverse.map((item) => item.symbol)
    const symbolBatches = []
    for (let index = 0; index < symbols.length; index += MAX_SYMBOLS) {
      symbolBatches.push(symbols.slice(index, index + MAX_SYMBOLS))
    }

    setLoading(true)
    setError('')
    setWarning('')
    setUniverseProgress({ completed: 0, total: symbolBatches.length })

    const aggregatedStocks = []
    const failedMessages = []

    try {
      let nextBatchIndex = 0

      async function runBatchWorker() {
        while (nextBatchIndex < symbolBatches.length) {
          if (universeRequestIdRef.current !== requestId) {
            return
          }

          const batch = symbolBatches[nextBatchIndex]
          nextBatchIndex += 1

          try {
            const endpoint = new URL('/api/stocks', window.location.origin)
            endpoint.searchParams.set('symbols', batch.join(','))

            const response = await fetch(endpoint)
            const payload = await response.json()

            if (universeRequestIdRef.current !== requestId) {
              return
            }

            if (!response.ok) {
              failedMessages.push(payload.error ?? 'Could not load one stock batch.')
            } else {
              aggregatedStocks.push(...(payload.data ?? []))
              setStocks([...aggregatedStocks])

              if (payload.failed?.length) {
                failedMessages.push(...payload.failed)
              }
            }
          } catch {
            failedMessages.push('Could not load one stock batch.')
          } finally {
            if (universeRequestIdRef.current === requestId) {
              setUniverseProgress((progress) => ({
                ...progress,
                completed: progress.completed + 1,
              }))
            }
          }
        }
      }

      const workers = Array.from(
        { length: Math.min(BATCH_CONCURRENCY, symbolBatches.length) },
        () => runBatchWorker()
      )
      await Promise.all(workers)

      if (universeRequestIdRef.current !== requestId) {
        return
      }

      setStocks(aggregatedStocks)

      if (!aggregatedStocks.length) {
        setError(
          failedMessages[0] ??
            'Could not load stock data for the selected universe.'
        )
      } else if (failedMessages.length) {
        setWarning(
          `Partial results loaded. Failed symbols: ${failedMessages.length}`
        )
      }
    } catch {
      if (universeRequestIdRef.current !== requestId) {
        return
      }

      setStocks([])
      setUniverseProgress({ completed: 0, total: symbolBatches.length })
      setError(
        'Could not connect to local server. Run npm run dev to start frontend and API.'
      )
    } finally {
      if (universeRequestIdRef.current === requestId) {
        setLoading(false)
      }
    }
  }, [filteredUniverse, mode])

  useEffect(() => {
    if (hasLoadedUniverseRef.current) {
      return
    }

    hasLoadedUniverseRef.current = true
    void loadUniverse()
  }, [loadUniverse])

  useEffect(() => {
    if (mode !== 'manual') {
      setCurrentPage(1)
    }
  }, [universeSearch, mode, trendFilter, countryFilter])

  useEffect(() => {
    if (mode !== 'universe') {
      return
    }

    const timeoutId = window.setTimeout(() => {
      void loadUniverseStocks()
    }, 350)

    return () => window.clearTimeout(timeoutId)
  }, [loadUniverseStocks, mode])

  function handleSubmit(event) {
    event.preventDefault()
    loadStocks(symbolsInput)
  }

  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">Stock Screener Landing</p>
        <h1>Stocks Sorted by Performance</h1>
        <p className="subtitle">
          Browse, filter, and sort by 1D, 1M, 1Y and trend signals.
        </p>
      </header>

      <section className="panel">
        <div className="sort">
          <span>Mode:</span>
          <button
            type="button"
            className={mode === 'universe' ? 'active' : ''}
            onClick={() => setMode('universe')}
          >
            Full market
          </button>
          <button
            type="button"
            className={mode === 'manual' ? 'active' : ''}
            onClick={() => setMode('manual')}
          >
            Manual (tickers)
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
              <div className="row">
                <input
                  id="universe-search"
                  type="text"
                  value={universeSearch}
                  onChange={(event) => setUniverseSearch(event.target.value)}
                  placeholder="Example: Apple, AAPL, NYSE"
                />
                <button type="button" onClick={() => void loadUniverse()}>
                  {universeLoading ? 'Refreshing...' : 'Refresh universe'}
                </button>
              </div>
            </form>

            <div className="sort">
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((value) => Math.max(1, value - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() =>
                  setCurrentPage((value) => Math.min(totalPages, value + 1))
                }
              >
                Next
              </button>
            </div>
          </>
        ) : null}

        {mode === 'manual' ? (
        <form className="controls" onSubmit={handleSubmit}>
          <label htmlFor="symbols">Manual tickers (max {MAX_SYMBOLS})</label>
          <div className="row">
            <input
              id="symbols"
              type="text"
              value={symbolsInput}
              onChange={(event) => setSymbolsInput(event.target.value)}
              placeholder="AAPL, MSFT, NVDA"
            />
            <button type="submit" disabled={loading}>
              {loading ? 'Loading...' : 'Update'}
            </button>
          </div>
        </form>
        ) : null}

        <div className="sort">
          <span>Sort by:</span>
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.id}
              className={sortMetric === option.id ? 'active' : ''}
              type="button"
              onClick={() => setSortMetric(option.id)}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() =>
              setSortDirection((current) =>
                current === 'desc' ? 'asc' : 'desc'
              )
            }
          >
            {sortDirection === 'desc' ? 'Highest first' : 'Lowest first'}
          </button>
        </div>
        <div className="sort trend-filter">
          <span>Trend label:</span>
          <button
            type="button"
            className={trendFilter === 'all' ? 'active' : ''}
            onClick={() => setTrendFilter('all')}
            title="Show all trend labels"
          >
            All
          </button>
          {TREND_LABELS.map((label) => (
            <button
              key={label}
              type="button"
              className={trendFilter === label ? 'active' : ''}
              onClick={() => setTrendFilter(label)}
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
        <div className="sort country-filter">
          <span>Country:</span>
          <button
            type="button"
            className={countryFilter === 'all' ? 'active' : ''}
            onClick={() => setCountryFilter('all')}
            title="Show all countries"
          >
            All
          </button>
          {COUNTRY_LABELS.map((label) => (
            <button
              key={label}
              type="button"
              className={countryFilter === label ? 'active' : ''}
              onClick={() => setCountryFilter(label)}
              title={`Filter by ${label}`}
            >
              {label}
            </button>
          ))}
        </div>

        {universeError ? <p className="status error">{universeError}</p> : null}
        {error ? <p className="status error">{error}</p> : null}
        {warning ? <p className="status warning">{warning}</p> : null}
        {mode === 'universe' && loading && universeProgress.total > 0 ? (
          <p className="status">
            Loading full market data... batch {universeProgress.completed} /{' '}
            {universeProgress.total}
          </p>
        ) : null}
      </section>

      <section className="panel profile-panel">
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

        <p className="status">
          Estimated profile: <strong>{riskProfile}</strong>
        </p>

        {recommendedStocks.length ? (
          <div className="recommendations">
            {recommendedStocks.map((stock) => (
              <article key={`rec-${stock.symbol}`} className="recommendation-card">
                <h3>
                  {stock.symbol} <small>{cleanCompanyName(stock.name) ?? 'N/A'}</small>
                </h3>
                <p>
                  Trend: <strong>{stock.trend.label}</strong> | Country:{' '}
                  <strong>{stock.country}</strong>
                </p>
                <p>
                  Suggested horizon: <strong>{stock.recommendedHorizon}</strong>
                </p>
                <p className={metricClass(stock.yearChange)}>
                  1Y performance: {formatPercent(stock.yearChange)}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <p className="status">No recommendations yet. Load stock data first.</p>
        )}
      </section>

      <section className="panel table-panel">
        <table>
          <thead>
            <tr>
              <th className="col-ticker">Ticker</th>
              <th className="col-name">Name</th>
              <th className="col-exchange">Exchange</th>
              <th className="col-price">Price</th>
              <th className="col-metric">1D</th>
              <th className="col-metric">1M</th>
              <th className="col-metric">1Y</th>
              <th className="col-trend">Trend signal</th>
              <th className="col-date">Updated</th>
            </tr>
          </thead>
          <tbody>
            {pagedStocks.map((stock) => (
              <tr key={stock.symbol}>
                <td className="col-ticker">{stock.symbol}</td>
                <td className="cell-name col-name" title={cleanCompanyName(stock.name) ?? 'N/A'}>
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

        {!loading && !pagedStocks.length && !error ? (
          <p className="status">No data to display.</p>
        ) : null}
        {mode === 'universe' &&
        loading &&
        (trendFilter !== 'all' || countryFilter !== 'all') &&
        !pagedStocks.length &&
        sortedStocks.length > 0 ? (
          <p className="status warning">
            No matching stocks yet with current filters ({trendFilter} /{' '}
            {countryFilter}). Try "All" or wait until loading finishes.
          </p>
        ) : null}
      </section>
    </main>
  )
}

export default App
