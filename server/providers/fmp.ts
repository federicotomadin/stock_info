// @ts-nocheck
import { FMP_API_KEY } from '../config.js'
import { fetchWithTimeout, withRetries } from '../lib/http.js'
import { buildStockFromSortedDailyCloses, normalizeOhlcvRows } from '../lib/stock.js'

export const FMP_STABLE_BASE = 'https://financialmodelingprep.com/stable'

export async function fetchFmpStableJson(path, params = {}) {
  if (!FMP_API_KEY) {
    throw new Error('FMP_API_KEY is not configured')
  }

  const url = new URL(`${FMP_STABLE_BASE}${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }
  url.searchParams.set('apikey', FMP_API_KEY)

  const response = await fetchWithTimeout(
    url.toString(),
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'stock-info-local-app/1.0',
      },
    },
    20000
  )

  const text = await response.text()
  let payload = null
  let parseError = null
  try {
    payload = JSON.parse(text)
  } catch (error) {
    parseError = error
  }

  if (!response.ok) {
    if (response.status === 402) {
      throw new Error(`FMP subscription required (HTTP 402): ${text.trim().slice(0, 220)}`)
    }
    const message =
      payload?.['Error Message'] ??
      payload?.message ??
      (text ? text.trim().slice(0, 220) : `FMP HTTP ${response.status}`)
    throw new Error(message)
  }

  if (parseError) {
    throw new Error(`FMP returned non-JSON (HTTP ${response.status}): ${text.trim().slice(0, 220)}`)
  }

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    if (payload['Error Message']) {
      throw new Error(payload['Error Message'])
    }
  }

  return payload
}

export function unwrapFmpFirstRow(payload) {
  if (Array.isArray(payload) && payload.length) {
    return payload[0]
  }
  return null
}

export function normalizeFmpDcf(payload) {
  if (Array.isArray(payload) && payload.length) {
    return payload[0]
  }
  if (payload && typeof payload === 'object' && Object.keys(payload).length) {
    return payload
  }
  return null
}

export async function fetchFmpFundamentalsBundle(symbol) {
  const upper = symbol.toUpperCase()
  const requests = [
    ['profile', '/profile', {}],
    ['keyMetricsTtm', '/key-metrics-ttm', {}],
    ['ratiosTtm', '/ratios-ttm', {}],
    ['incomeStatement', '/income-statement', { limit: 5 }],
    ['balanceSheet', '/balance-sheet-statement', { limit: 5 }],
    ['cashFlow', '/cash-flow-statement', { limit: 5 }],
    ['dcf', '/discounted-cash-flow', {}],
  ]

  const settled = await Promise.all(
    requests.map(async ([key, path, params]) => {
      try {
        const data = await fetchFmpStableJson(path, { symbol: upper, ...params })
        return [key, { ok: true, data }]
      } catch (error) {
        return [key, { ok: false, error: error?.message ?? String(error) }]
      }
    })
  )

  const map = Object.fromEntries(settled)

  return {
    symbol: upper,
    dataSource: 'financialmodelingprep.com (stable)',
    profile: map.profile?.ok ? unwrapFmpFirstRow(map.profile.data) : null,
    profileError: map.profile?.ok ? null : map.profile?.error,
    keyMetricsTtm: map.keyMetricsTtm?.ok ? unwrapFmpFirstRow(map.keyMetricsTtm.data) : null,
    keyMetricsTtmError: map.keyMetricsTtm?.ok ? null : map.keyMetricsTtm?.error,
    ratiosTtm: map.ratiosTtm?.ok ? unwrapFmpFirstRow(map.ratiosTtm.data) : null,
    ratiosTtmError: map.ratiosTtm?.ok ? null : map.ratiosTtm?.error,
    incomeStatementAnnual: map.incomeStatement?.ok && Array.isArray(map.incomeStatement.data)
      ? map.incomeStatement.data
      : [],
    incomeStatementError: map.incomeStatement?.ok ? null : map.incomeStatement?.error,
    balanceSheetAnnual: map.balanceSheet?.ok && Array.isArray(map.balanceSheet.data)
      ? map.balanceSheet.data
      : [],
    balanceSheetError: map.balanceSheet?.ok ? null : map.balanceSheet?.error,
    cashFlowAnnual: map.cashFlow?.ok && Array.isArray(map.cashFlow.data)
      ? map.cashFlow.data
      : [],
    cashFlowError: map.cashFlow?.ok ? null : map.cashFlow?.error,
    discountedCashFlow: map.dcf?.ok ? normalizeFmpDcf(map.dcf.data) : null,
    discountedCashFlowError: map.dcf?.ok ? null : map.dcf?.error,
  }
}

export async function fetchOhlcvFromFmp(symbol, { lookbackDays = 260 } = {}) {
  if (!FMP_API_KEY) {
    throw new Error('FMP_API_KEY is not configured')
  }

  const upper = symbol.toUpperCase()
  const fromDate = new Date()
  fromDate.setDate(fromDate.getDate() - lookbackDays - 30)
  const from = fromDate.toISOString().slice(0, 10)

  const payload = await withRetries(
    async () =>
      fetchFmpStableJson('/historical-price-eod/full', {
        symbol: upper,
        from,
      }),
    1
  )
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.historical)
      ? payload.historical
      : []

  if (rows.length < 30) {
    throw new Error(
      `FMP returned only ${rows.length} OHLCV rows for ${symbol} (need 30+ for indicators).`
    )
  }
  return normalizeOhlcvRows(rows)
}

export async function fetchSymbolDataFromFmp(symbol) {
  if (!FMP_API_KEY) {
    throw new Error('FMP_API_KEY is not configured')
  }

  const upper = symbol.toUpperCase()
  const twoYearsAgo = new Date()
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)
  const from = twoYearsAgo.toISOString().slice(0, 10)

  const payload = await withRetries(
    async () =>
      fetchFmpStableJson('/historical-price-eod/full', {
        symbol: upper,
        from,
      }),
    1
  )

  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.historical)
      ? payload.historical
      : []

  if (rows.length < 3) {
    throw new Error(`FMP returned insufficient rows for ${symbol}`)
  }

  const sorted = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const closes = sorted.map((row) => Number(row.close ?? row.adjClose))
  const latestRow = sorted[sorted.length - 1]

  return buildStockFromSortedDailyCloses(symbol, closes, latestRow?.date)
}
