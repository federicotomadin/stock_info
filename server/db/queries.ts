import { analyzeTrend } from './trend.js'
import { getPool } from './pool.js'

export type SortMetric = 'trend' | 'day' | 'month' | 'year'
export type SortDirection = 'asc' | 'desc'

export interface ScreenerRow {
  symbol: string
  name: string
  exchange: string
  country: string
  price: number
  updatedAt: string
  dayChange: number | null
  monthChange: number | null
  yearChange: number | null
  trendScore: number
  trendLabel: string
}

export interface ScreenerQuery {
  offset?: number
  limit?: number
  sort?: SortMetric
  dir?: SortDirection
  search?: string
  trend?: string
  country?: string
}

export interface ScreenerResult {
  data: Array<
    ScreenerRow & {
      trend: ReturnType<typeof analyzeTrend>
    }
  >
  total: number
  offset: number
  limit: number
  sort: SortMetric
  dir: SortDirection
}

const SORT_COLUMNS: Record<SortMetric, string> = {
  trend: 'q.trend_score',
  day: 'q.day_change',
  month: 'q.month_change',
  year: 'q.year_change',
}

function normalizeSort(sort: string | undefined): SortMetric {
  if (sort === 'trend' || sort === 'day' || sort === 'month' || sort === 'year') {
    return sort
  }
  return 'year'
}

function normalizeDir(dir: string | undefined): SortDirection {
  return dir === 'asc' ? 'asc' : 'desc'
}

export async function queryScreener(raw: ScreenerQuery): Promise<ScreenerResult> {
  const pool = getPool()
  const offset = Math.max(0, Number(raw.offset) || 0)
  const limit = Math.min(200, Math.max(1, Number(raw.limit) || 50))
  const sort = normalizeSort(raw.sort)
  const dir = normalizeDir(raw.dir)
  const sortColumn = SORT_COLUMNS[sort]
  const nullsOrder = dir === 'desc' ? 'NULLS LAST' : 'NULLS FIRST'
  const orderDir = dir === 'asc' ? 'ASC' : 'DESC'

  const conditions: string[] = ['1=1']
  const params: unknown[] = []
  let paramIndex = 1

  const search = raw.search?.trim()
  if (search) {
    conditions.push(
      `(t.symbol ILIKE $${paramIndex} OR t.name ILIKE $${paramIndex} OR t.exchange ILIKE $${paramIndex})`
    )
    params.push(`%${search}%`)
    paramIndex += 1
  }

  const trend = raw.trend?.trim()
  if (trend && trend !== 'all') {
    conditions.push(`q.trend_label = $${paramIndex}`)
    params.push(trend)
    paramIndex += 1
  }

  const country = raw.country?.trim()
  if (country && country !== 'all') {
    conditions.push(`t.country = $${paramIndex}`)
    params.push(country)
    paramIndex += 1
  }

  const whereClause = conditions.join(' AND ')

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM tickers t
     INNER JOIN stock_quotes q ON q.symbol = t.symbol
     WHERE ${whereClause}`,
    params
  )

  const total = countResult.rows[0]?.total ?? 0

  const dataResult = await pool.query(
    `SELECT
       t.symbol,
       t.name,
       t.exchange,
       t.country,
       q.price,
       q.quote_updated_at,
       q.day_change,
       q.month_change,
       q.year_change,
       q.trend_score,
       q.trend_label
     FROM tickers t
     INNER JOIN stock_quotes q ON q.symbol = t.symbol
     WHERE ${whereClause}
     ORDER BY ${sortColumn} ${orderDir} ${nullsOrder}, t.symbol ASC
     OFFSET $${paramIndex}
     LIMIT $${paramIndex + 1}`,
    [...params, offset, limit]
  )

  const data = dataResult.rows.map((row) => {
    const dayChange = row.day_change == null ? null : Number(row.day_change)
    const monthChange = row.month_change == null ? null : Number(row.month_change)
    const yearChange = row.year_change == null ? null : Number(row.year_change)
    const trendAnalysis = analyzeTrend({ dayChange, monthChange, yearChange })

    return {
      symbol: row.symbol,
      name: row.name,
      exchange: row.exchange,
      country: row.country,
      price: Number(row.price),
      updatedAt: row.quote_updated_at
        ? String(row.quote_updated_at).slice(0, 10)
        : '',
      dayChange,
      monthChange,
      yearChange,
      trendScore: Number(row.trend_score),
      trendLabel: row.trend_label,
      trend: trendAnalysis,
    }
  })

  return { data, total, offset, limit, sort, dir }
}

export interface UpsertTickerInput {
  symbol: string
  name: string
  exchange: string
  country: string
}

export interface UpsertQuoteInput {
  symbol: string
  price: number
  updatedAt: string
  dayChange: number | null
  monthChange: number | null
  yearChange: number | null
  trendScore: number
  trendLabel: string
}

export async function upsertTicker(input: UpsertTickerInput): Promise<void> {
  const pool = getPool()
  await pool.query(
    `INSERT INTO tickers (symbol, name, exchange, country, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (symbol) DO UPDATE SET
       name = EXCLUDED.name,
       exchange = EXCLUDED.exchange,
       country = EXCLUDED.country,
       updated_at = NOW()
     WHERE tickers.name IS DISTINCT FROM EXCLUDED.name
        OR tickers.exchange IS DISTINCT FROM EXCLUDED.exchange
        OR tickers.country IS DISTINCT FROM EXCLUDED.country`,
    [input.symbol, input.name, input.exchange, input.country]
  )
}

/** Returns true when a row was inserted or values changed. */
export async function upsertQuote(input: UpsertQuoteInput): Promise<boolean> {
  const pool = getPool()
  const quoteDate = input.updatedAt ? input.updatedAt.slice(0, 10) : null

  const result = await pool.query(
    `INSERT INTO stock_quotes (
       symbol, price, quote_updated_at, day_change, month_change, year_change,
       trend_score, trend_label, synced_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (symbol) DO UPDATE SET
       price = EXCLUDED.price,
       quote_updated_at = EXCLUDED.quote_updated_at,
       day_change = EXCLUDED.day_change,
       month_change = EXCLUDED.month_change,
       year_change = EXCLUDED.year_change,
       trend_score = EXCLUDED.trend_score,
       trend_label = EXCLUDED.trend_label,
       synced_at = NOW()
     WHERE stock_quotes.price IS DISTINCT FROM EXCLUDED.price
        OR stock_quotes.quote_updated_at IS DISTINCT FROM EXCLUDED.quote_updated_at
        OR stock_quotes.day_change IS DISTINCT FROM EXCLUDED.day_change
        OR stock_quotes.month_change IS DISTINCT FROM EXCLUDED.month_change
        OR stock_quotes.year_change IS DISTINCT FROM EXCLUDED.year_change
        OR stock_quotes.trend_score IS DISTINCT FROM EXCLUDED.trend_score
        OR stock_quotes.trend_label IS DISTINCT FROM EXCLUDED.trend_label
     RETURNING symbol`,
    [
      input.symbol,
      input.price,
      quoteDate,
      input.dayChange,
      input.monthChange,
      input.yearChange,
      input.trendScore,
      input.trendLabel,
    ]
  )

  return result.rowCount > 0
}

export interface SyncStatus {
  enabled: true
  syncing: boolean
  totalQuotes: number
  totalTickers: number
  lastSyncAt: string | null
  lastSyncUpdated: number | null
  lastSyncUnchanged: number | null
  lastSyncFailed: number | null
}

export async function getSyncStatus(syncing: boolean): Promise<SyncStatus> {
  const pool = getPool()

  const [counts, lastRun] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM tickers) AS tickers,
        (SELECT COUNT(*)::int FROM stock_quotes) AS quotes
    `),
    pool.query(`
      SELECT finished_at, symbols_updated, symbols_unchanged, symbols_failed
      FROM sync_runs
      WHERE status = 'completed'
      ORDER BY finished_at DESC NULLS LAST
      LIMIT 1
    `),
  ])

  const last = lastRun.rows[0]

  return {
    enabled: true,
    syncing,
    totalTickers: counts.rows[0]?.tickers ?? 0,
    totalQuotes: counts.rows[0]?.quotes ?? 0,
    lastSyncAt: last?.finished_at ? new Date(last.finished_at).toISOString() : null,
    lastSyncUpdated: last?.symbols_updated ?? null,
    lastSyncUnchanged: last?.symbols_unchanged ?? null,
    lastSyncFailed: last?.symbols_failed ?? null,
  }
}

export async function startSyncRun(symbolsTotal: number): Promise<number> {
  const pool = getPool()
  const result = await pool.query(
    `INSERT INTO sync_runs (symbols_total, status)
     VALUES ($1, 'running')
     RETURNING id`,
    [symbolsTotal]
  )
  return result.rows[0].id
}

export async function finishSyncRun(
  runId: number,
  stats: { updated: number; unchanged: number; failed: number }
): Promise<void> {
  const pool = getPool()
  await pool.query(
    `UPDATE sync_runs SET
       finished_at = NOW(),
       symbols_updated = $2,
       symbols_unchanged = $3,
       symbols_failed = $4,
       status = 'completed'
     WHERE id = $1`,
    [runId, stats.updated, stats.unchanged, stats.failed]
  )
}

export async function failSyncRun(runId: number): Promise<void> {
  const pool = getPool()
  await pool.query(
    `UPDATE sync_runs SET finished_at = NOW(), status = 'failed' WHERE id = $1`,
    [runId]
  )
}

export async function getLatestSyncFinishedAt(): Promise<Date | null> {
  const pool = getPool()
  const result = await pool.query(
    `SELECT finished_at FROM sync_runs
     WHERE status = 'completed'
     ORDER BY finished_at DESC NULLS LAST
     LIMIT 1`
  )
  const value = result.rows[0]?.finished_at
  return value ? new Date(value) : null
}
