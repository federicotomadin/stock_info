// @ts-nocheck
import { FETCH_RETRIES } from '../config.js'
import { wait } from './utils.js'

export async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function withRetries(operation, retries = FETCH_RETRIES, delayMs = 250) {
  let lastError

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt === retries) {
        throw lastError
      }
      await wait(delayMs * (attempt + 1))
    }
  }

  throw lastError
}

export function parseRetryAfterMs(response) {
  if (!response) {
    return null
  }
  const raw = response.headers.get('Retry-After')?.trim()
  if (!raw) {
    return null
  }
  const asInt = parseInt(raw, 10)
  if (Number.isFinite(asInt) && asInt >= 0) {
    if (asInt < 200) {
      return Math.min(120_000, asInt * 1000)
    }
    return Math.min(120_000, asInt)
  }
  const asDate = Date.parse(raw)
  if (Number.isFinite(asDate)) {
    return Math.max(0, Math.min(120_000, asDate - Date.now()))
  }
  return null
}

export const YAHOO_HTTP_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
}

const YAHOO_MIN_REQUEST_GAP_MS = 400
let yahooNextSlotAt = 0

export async function paceYahooRequest() {
  const now = Date.now()
  const delay = Math.max(0, yahooNextSlotAt - now)
  if (delay > 0) {
    await wait(delay)
  }
  yahooNextSlotAt = Date.now() + YAHOO_MIN_REQUEST_GAP_MS
}

/**
 * Retries for Yahoo rate limits (HTTP 429) and transient 5xx with exponential backoff.
 */
export async function withYahooHttpRetries(
  operation,
  { shouldRetry = () => true, maxAttempts = 6, baseMs = 1600, maxMs = 60_000 } = {}
) {
  let lastError
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      const e = error instanceof Error ? error : new Error(String(error))
      const retryable = shouldRetry(e)
      if (attempt === maxAttempts - 1 || !retryable) {
        throw e
      }
      const custom = 'backoffMs' in e && typeof e.backoffMs === 'number' ? e.backoffMs : null
      const exp = Math.min(maxMs, baseMs * 2 ** attempt)
      const delayMs = custom != null && Number.isFinite(custom) ? Math.min(maxMs, custom) : exp
      await wait(delayMs)
    }
  }
  throw lastError
}

export function isYahooRetryableError(error) {
  const m = error?.message ?? ''
  if (/Yahoo HTTP (429|502|503|504)/.test(m)) {
    return true
  }
  if (m.includes('Yahoo') && m.includes('fetch failed')) {
    return true
  }
  return false
}
