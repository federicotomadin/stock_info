import { SortableHeader } from './SortableHeader'
import { TickerActionsMenu } from './TickerActionsMenu'
import { useTickerHoverProfiles } from '../hooks/useTickerHoverProfiles'
import { cleanCompanyName, companyTooltip, formatPercent, metricClass, trendTooltip } from '../utils'
import type { EnrichedStock, SortDirection, SortMetric, TrendLabel, CountryLabel } from '../types/stock'

interface ScreenerTableProps {
  stocks: EnrichedStock[]
  sortMetric: SortMetric
  sortDirection: SortDirection
  onSort: (metricId: SortMetric) => void
  onOpenFundamentals: (symbol: string) => void
  onOpenTechnical: (symbol: string) => void
  loading: boolean
  error: string
  isFullMarketNonDb: boolean
  trendFilter: TrendLabel | 'all'
  countryFilter: CountryLabel | 'all'
  hasAnySortedStocks: boolean
}

export function ScreenerTable({
  stocks,
  sortMetric,
  sortDirection,
  onSort,
  onOpenFundamentals,
  onOpenTechnical,
  loading,
  error,
  isFullMarketNonDb,
  trendFilter,
  countryFilter,
  hasAnySortedStocks,
}: ScreenerTableProps) {
  const { getProfile, requestProfile } = useTickerHoverProfiles()

  return (
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
                  onSort={onSort}
                />
              </th>
              <th className="col-metric">
                <SortableHeader
                  metricId="month"
                  label="1M"
                  sortMetric={sortMetric}
                  sortDirection={sortDirection}
                  onSort={onSort}
                />
              </th>
              <th className="col-metric">
                <SortableHeader
                  metricId="year"
                  label="1Y"
                  sortMetric={sortMetric}
                  sortDirection={sortDirection}
                  onSort={onSort}
                />
              </th>
              <th className="col-trend">
                <SortableHeader
                  metricId="trend"
                  label="Trend Signal"
                  sortMetric={sortMetric}
                  sortDirection={sortDirection}
                  onSort={onSort}
                />
              </th>
              <th className="col-date">Updated</th>
            </tr>
          </thead>
          <tbody>
            {stocks.map((stock) => (
              <tr key={stock.symbol}>
                <td className="col-ticker">
                  <TickerActionsMenu
                    symbol={stock.symbol}
                    onOpenFundamentals={() => onOpenFundamentals(stock.symbol)}
                    onOpenTechnical={() => onOpenTechnical(stock.symbol)}
                    tooltip={companyTooltip(stock.symbol, cleanCompanyName(stock.name), getProfile(stock.symbol))}
                    onHover={() => requestProfile(stock.symbol)}
                  />
                </td>
                <td
                  className="cell-name col-name"
                  title={companyTooltip(stock.symbol, cleanCompanyName(stock.name), getProfile(stock.symbol))}
                  onMouseEnter={() => requestProfile(stock.symbol)}
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
                <td className="col-trend" title={trendTooltip(stock.trend.label, stock.trend.detail)}>
                  <span className={`trend-chip ${stock.trend.tone}`}>{stock.trend.label}</span>
                </td>
                <td className="col-date">{stock.updatedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && !stocks.length && !error ? (
        <div className="empty-state">
          <p>No data to display.</p>
        </div>
      ) : null}
      {isFullMarketNonDb &&
      (trendFilter !== 'all' || countryFilter !== 'all') &&
      !stocks.length &&
      hasAnySortedStocks ? (
        <p className="status warning">
          No matching stocks yet with current filters ({trendFilter} / {countryFilter}). Try
          &quot;All&quot; or wait until loading finishes.
        </p>
      ) : null}
    </div>
  )
}
