import type { SortDirection, SortMetric } from '../types/stock'

interface SortableHeaderProps {
  metricId: SortMetric
  label: string
  sortMetric: SortMetric
  sortDirection: SortDirection
  onSort: (metricId: SortMetric) => void
}

export function SortableHeader({
  metricId,
  label,
  sortMetric,
  sortDirection,
  onSort,
}: SortableHeaderProps) {
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
      aria-sort={isActive ? (sortDirection === 'desc' ? 'descending' : 'ascending') : 'none'}
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
