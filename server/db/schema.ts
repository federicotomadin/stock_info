import { getPool } from './pool.js'

export async function initSchema(): Promise<void> {
  const pool = getPool()

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickers (
      symbol TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      exchange TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT 'EE.UU',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS stock_quotes (
      symbol TEXT PRIMARY KEY REFERENCES tickers(symbol) ON DELETE CASCADE,
      price DOUBLE PRECISION NOT NULL,
      quote_updated_at DATE,
      day_change DOUBLE PRECISION,
      month_change DOUBLE PRECISION,
      year_change DOUBLE PRECISION,
      trend_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      trend_label TEXT NOT NULL DEFAULT 'Neutral',
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sync_runs (
      id SERIAL PRIMARY KEY,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      symbols_total INT,
      symbols_updated INT DEFAULT 0,
      symbols_unchanged INT DEFAULT 0,
      symbols_failed INT DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'running'
    );

    CREATE INDEX IF NOT EXISTS idx_stock_quotes_year_change
      ON stock_quotes (year_change DESC NULLS LAST);
    CREATE INDEX IF NOT EXISTS idx_stock_quotes_month_change
      ON stock_quotes (month_change DESC NULLS LAST);
    CREATE INDEX IF NOT EXISTS idx_stock_quotes_day_change
      ON stock_quotes (day_change DESC NULLS LAST);
    CREATE INDEX IF NOT EXISTS idx_stock_quotes_trend_score
      ON stock_quotes (trend_score DESC NULLS LAST);
    CREATE INDEX IF NOT EXISTS idx_tickers_country ON tickers (country);
    CREATE INDEX IF NOT EXISTS idx_tickers_symbol_lower ON tickers (LOWER(symbol));
    CREATE INDEX IF NOT EXISTS idx_tickers_name_lower ON tickers (LOWER(name));
  `)
}
