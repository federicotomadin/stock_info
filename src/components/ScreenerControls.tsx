import type { FormEvent } from 'react'
import { COUNTRY_LABELS, SORT_OPTIONS, TREND_LABELS, TREND_MEANINGS } from '../models/constants'
import { MAX_SYMBOLS } from '../constants/app'
import type { AppMode, CountryLabel, SortDirection, SortMetric, TrendLabel, UniverseProgress } from '../types/stock'

interface ScreenerControlsProps {
  mode: AppMode
  onSelectUniverseMode: () => void
  onSelectManualMode: () => void
  universeSearch: string
  onUniverseSearchChange: (value: string) => void
  filteredUniverseCount: number
  universeLoading: boolean
  onRefreshUniverse: () => void
  currentPage: number
  totalPages: number
  screenerTotal: number
  useDbScreener: boolean
  onPrevPage: () => void
  onNextPage: () => void
  symbolsInput: string
  onSymbolsInputChange: (value: string) => void
  manualStocksLoading: boolean
  onManualSubmit: (event: FormEvent<HTMLFormElement>) => void
  sortMetric: SortMetric
  onSortMetricChange: (metric: SortMetric) => void
  sortDirection: SortDirection
  onToggleSortDirection: () => void
  trendFilter: TrendLabel | 'all'
  onTrendFilterChange: (label: TrendLabel | 'all') => void
  countryFilter: CountryLabel | 'all'
  onCountryFilterChange: (label: CountryLabel | 'all') => void
  universeError: string
  error: string
  warning: string
  onRefreshWarningData: () => void
  fullMarketStocksLoading: boolean
  universeProgress: UniverseProgress
  progressPercent: number
}

export function ScreenerControls({
  mode,
  onSelectUniverseMode,
  onSelectManualMode,
  universeSearch,
  onUniverseSearchChange,
  filteredUniverseCount,
  universeLoading,
  onRefreshUniverse,
  currentPage,
  totalPages,
  screenerTotal,
  useDbScreener,
  onPrevPage,
  onNextPage,
  symbolsInput,
  onSymbolsInputChange,
  manualStocksLoading,
  onManualSubmit,
  sortMetric,
  onSortMetricChange,
  sortDirection,
  onToggleSortDirection,
  trendFilter,
  onTrendFilterChange,
  countryFilter,
  onCountryFilterChange,
  universeError,
  error,
  warning,
  onRefreshWarningData,
  fullMarketStocksLoading,
  universeProgress,
  progressPercent,
}: ScreenerControlsProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <span className="panel-title">Controls</span>
      </div>

      <div className="toolbar">
        <span className="toolbar-label">Mode:</span>
        <button
          type="button"
          className={`chip ${mode === 'universe' ? 'active' : ''}`}
          onClick={onSelectUniverseMode}
        >
          Full market
        </button>
        <button
          type="button"
          className={`chip ${mode === 'manual' ? 'active' : ''}`}
          onClick={onSelectManualMode}
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
            }}
          >
            <label htmlFor="universe-search">Search market ({filteredUniverseCount} symbols)</label>
            <div className="input-row">
              <input
                id="universe-search"
                className="input-field"
                type="text"
                value={universeSearch}
                onChange={(event) => onUniverseSearchChange(event.target.value)}
                placeholder="Example: Apple, AAPL, NYSE"
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onRefreshUniverse}
                title="Vuelve a bajar el listing oficial de NASDAQ y NYSE (ignora cache server-side)"
              >
                {universeLoading ? 'Refreshing...' : 'Refresh universe'}
              </button>
            </div>
          </form>

          <div className="pagination">
            <span className="pagination-label">
              Page {currentPage} of {totalPages}
              {useDbScreener ? ` · ${screenerTotal.toLocaleString()} total` : ''}
            </span>
            <button type="button" className="btn btn-secondary" disabled={currentPage <= 1} onClick={onPrevPage}>
              Previous
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={currentPage >= totalPages}
              onClick={onNextPage}
            >
              Next
            </button>
          </div>
        </>
      ) : null}

      {mode === 'manual' ? (
        <form className="controls" onSubmit={onManualSubmit}>
          <label htmlFor="symbols">Manual tickers (max {MAX_SYMBOLS})</label>
          <div className="input-row">
            <input
              id="symbols"
              className="input-field"
              type="text"
              value={symbolsInput}
              onChange={(event) => onSymbolsInputChange(event.target.value)}
              placeholder="AAPL, MSFT, NVDA"
            />
            <button type="submit" className="btn btn-primary" disabled={manualStocksLoading}>
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
            onClick={() => onSortMetricChange(option.id)}
          >
            {option.label}
          </button>
        ))}
        <button type="button" className="chip" onClick={onToggleSortDirection}>
          {sortDirection === 'desc' ? 'Highest first' : 'Lowest first'}
        </button>
      </div>

      <div className="toolbar">
        <span className="toolbar-label">Trend:</span>
        <button
          type="button"
          className={`chip ${trendFilter === 'all' ? 'active' : ''}`}
          onClick={() => onTrendFilterChange('all')}
          title="Show all trend labels"
        >
          All
        </button>
        {TREND_LABELS.map((label) => (
          <button
            key={label}
            type="button"
            className={`chip ${trendFilter === label ? 'active' : ''}`}
            onClick={() => onTrendFilterChange(label)}
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
          onClick={() => onCountryFilterChange('all')}
          title="Show all countries"
        >
          All
        </button>
        {COUNTRY_LABELS.map((label) => (
          <button
            key={label}
            type="button"
            className={`chip ${countryFilter === label ? 'active' : ''}`}
            onClick={() => onCountryFilterChange(label)}
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
              onClick={onRefreshWarningData}
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
              <div className="progress-bar-fill" style={{ width: `${progressPercent}%` }} />
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
