export const PAGE_SIZE = 20
export const SCROLLER_PAGE_SIZE = 50
export const MAX_SYMBOLS = 120
export const BATCH_CONCURRENCY = 3
export const MANUAL_STOCKS_DEBOUNCE_MS = 450
export const CACHE_TTL_MS = 20 * 60 * 1000
export const MARKET_SNAPSHOT_STORAGE_KEY = 'market-snapshot'

/** Render free Postgres expiry (ISO date). Empty string hides the banner. */
export const DB_EXPIRES_AT = String(import.meta.env.VITE_DB_EXPIRES_AT ?? '2026-08-08').trim()

export const RENDER_POSTGRES_DOCS_URL =
  'https://render.com/docs/free#free-postgres-instances'
