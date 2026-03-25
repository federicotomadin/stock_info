import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const DEFAULT_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'TSLA']
const PAGE_SIZE = 20
const MAX_SYMBOLS = 120

const SORT_OPTIONS = [
  { id: 'day', label: '1D' },
  { id: 'month', label: '1M' },
  { id: 'year', label: '1Y' },
]

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
    const sorted = stocks.map((stock) => ({
      ...stock,
      ...(metadataBySymbol.get(stock.symbol) ?? {}),
    }))

    sorted.sort((a, b) => {
      const metricByKey = {
        day: 'dayChange',
        month: 'monthChange',
        year: 'yearChange',
      }

      const key = metricByKey[sortMetric]
      const valueA = a[key] ?? Number.NEGATIVE_INFINITY
      const valueB = b[key] ?? Number.NEGATIVE_INFINITY

      if (sortDirection === 'asc') {
        return valueA - valueB
      }

      return valueB - valueA
    })

    return sorted
  }, [metadataBySymbol, stocks, sortMetric, sortDirection])

  const pagedStocks = useMemo(() => {
    if (mode !== 'universe') {
      return sortedStocks
    }

    const start = (currentPage - 1) * PAGE_SIZE
    return sortedStocks.slice(start, start + PAGE_SIZE)
  }, [currentPage, mode, sortedStocks])

  const totalPages = useMemo(() => {
    if (mode !== 'universe') {
      return 1
    }

    return Math.max(1, Math.ceil(sortedStocks.length / PAGE_SIZE))
  }, [mode, sortedStocks.length])

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
      for (const batch of symbolBatches) {
        const endpoint = new URL('/api/stocks', window.location.origin)
        endpoint.searchParams.set('symbols', batch.join(','))

        const response = await fetch(endpoint)
        const payload = await response.json()

        if (universeRequestIdRef.current !== requestId) {
          return
        }

        if (!response.ok) {
          failedMessages.push(payload.error ?? 'Could not load one stock batch.')
          setUniverseProgress((progress) => ({
            ...progress,
            completed: progress.completed + 1,
          }))
          continue
        }

        aggregatedStocks.push(...(payload.data ?? []))
        setStocks([...aggregatedStocks])
        setUniverseProgress((progress) => ({
          ...progress,
          completed: progress.completed + 1,
        }))
        if (payload.failed?.length) {
          failedMessages.push(...payload.failed)
        }
      }

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
  }, [universeSearch, mode])

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
        <p className="subtitle">Browse, filter, and sort by 1D, 1M, and 1Y performance.</p>
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

      <section className="panel table-panel">
        <table>
          <thead>
            <tr>
              <th>Ticker</th>
              <th className="col-name">Name</th>
              <th className="col-exchange">Exchange</th>
              <th className="col-price">Price</th>
              <th className="col-metric">1D</th>
              <th className="col-metric">1M</th>
              <th className="col-metric">1Y</th>
              <th className="col-date">Updated</th>
            </tr>
          </thead>
          <tbody>
            {pagedStocks.map((stock) => (
              <tr key={stock.symbol}>
                <td>{stock.symbol}</td>
                <td className="cell-name" title={stock.name ?? 'N/A'}>
                  {stock.name ?? 'N/A'}
                </td>
                <td className="col-exchange">{stock.exchange ?? 'N/A'}</td>
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
                <td className="col-date">{stock.updatedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {!loading && !pagedStocks.length && !error ? (
          <p className="status">No data to display.</p>
        ) : null}
      </section>
    </main>
  )
}

export default App
