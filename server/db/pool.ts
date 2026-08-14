import pg from 'pg'

const { Pool } = pg

let pool: pg.Pool | null = null

function isLocalDatabaseUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return hostname === 'localhost' || hostname === '127.0.0.1'
  } catch {
    return false
  }
}

export function isDatabaseEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim())
}

export function getPool(): pg.Pool {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) {
    throw new Error('DATABASE_URL is not configured')
  }

  if (!pool) {
    pool = new Pool({
      connectionString: url,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      ssl: isLocalDatabaseUrl(url) ? undefined : { rejectUnauthorized: false },
    })
  }

  return pool
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
