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
      rsi_14 DOUBLE PRECISION,
      sma_20 DOUBLE PRECISION,
      sma_50 DOUBLE PRECISION,
      sma_200 DOUBLE PRECISION,
      trend_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      trend_label TEXT NOT NULL DEFAULT 'Neutral',
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE stock_quotes ADD COLUMN IF NOT EXISTS rsi_14 DOUBLE PRECISION;
    ALTER TABLE stock_quotes ADD COLUMN IF NOT EXISTS sma_20 DOUBLE PRECISION;
    ALTER TABLE stock_quotes ADD COLUMN IF NOT EXISTS sma_50 DOUBLE PRECISION;
    ALTER TABLE stock_quotes ADD COLUMN IF NOT EXISTS sma_200 DOUBLE PRECISION;
    ALTER TABLE tickers ADD COLUMN IF NOT EXISTS market_cap DOUBLE PRECISION;

    CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      unsubscribe_token TEXT NOT NULL UNIQUE,
      subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      unsubscribed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS newsletter_sends (
      id SERIAL PRIMARY KEY,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      recipients_count INT NOT NULL DEFAULT 0,
      symbols TEXT
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

    CREATE TABLE IF NOT EXISTS agent_runs (
      id SERIAL PRIMARY KEY,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'running',
      summary TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_decisions (
      id SERIAL PRIMARY KEY,
      run_id INT REFERENCES agent_runs(id) ON DELETE SET NULL,
      at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      kind TEXT NOT NULL,
      symbol TEXT,
      detail TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_trades (
      id SERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'placed',
      quantity INT NOT NULL,
      entry_price DOUBLE PRECISION NOT NULL,
      stop_loss DOUBLE PRECISION NOT NULL,
      take_profit DOUBLE PRECISION NOT NULL,
      original_stop DOUBLE PRECISION NOT NULL,
      parent_order_id INT,
      stop_order_id INT,
      take_profit_order_id INT,
      reason TEXT,
      opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      exit_reason TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_agent_decisions_at ON agent_decisions (at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_trades_status ON agent_trades (status);
    CREATE INDEX IF NOT EXISTS idx_agent_trades_opened_at ON agent_trades (opened_at DESC);

    CREATE TABLE IF NOT EXISTS agent_session_days (
      day DATE PRIMARY KEY,
      open_nl DOUBLE PRECISION,
      close_nl DOUBLE PRECISION,
      report_sent_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS agent_fills (
      exec_id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      quantity DOUBLE PRECISION NOT NULL,
      price DOUBLE PRECISION NOT NULL,
      session_date DATE NOT NULL,
      executed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_agent_fills_session_date ON agent_fills (session_date);
  `)
}
