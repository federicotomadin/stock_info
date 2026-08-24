// @ts-nocheck
import { cleanBusinessSummary, extractFoundedYear, toYahooTicker } from '../lib/utils.js'
import {
  fetchWithTimeout,
  isYahooRetryableError,
  paceYahooRequest,
  parseRetryAfterMs,
  withYahooHttpRetries,
  YAHOO_HTTP_HEADERS,
} from '../lib/http.js'
import { buildStockFromYahoo, isValidOhlcvCandle } from '../lib/stock.js'

const YAHOO_HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']

export async function fetchOhlcvFromYahoo(symbol, { lookbackDays = 260 } = {}) {
  const yahooTicker = toYahooTicker(symbol)
  const range = lookbackDays > 365 ? '2y' : lookbackDays > 180 ? '1y' : '6mo'

  let lastError = null
  for (const host of YAHOO_HOSTS) {
    try {
      return await withYahooHttpRetries(
        async () => {
          await paceYahooRequest()
          const endpoint =
            `${host}/v8/finance/chart/${encodeURIComponent(yahooTicker)}` +
            `?range=${range}&interval=1d&events=div,splits&includePrePost=false`
          const response = await fetchWithTimeout(
            endpoint,
            { headers: YAHOO_HTTP_HEADERS },
            12000
          )

          if (response.status === 429) {
            const err = new Error('Yahoo HTTP 429')
            const ra = parseRetryAfterMs(response)
            if (ra != null) {
              err.backoffMs = ra
            }
            throw err
          }

          if (!response.ok) {
            throw new Error(`Yahoo HTTP ${response.status}`)
          }

          const payload = await response.json()
          const yahooError = payload?.chart?.error?.description
          if (yahooError) {
            throw new Error(yahooError)
          }

          const result = payload?.chart?.result?.[0]
          const quote = result?.indicators?.quote?.[0]
          const timestamps = result?.timestamp

          if (!Array.isArray(timestamps) || !quote) {
            throw new Error(`Yahoo returned no chart data for ${symbol}`)
          }

          const candles = []
          for (let i = 0; i < timestamps.length; i += 1) {
            const o = Number(quote.open?.[i])
            const h = Number(quote.high?.[i])
            const l = Number(quote.low?.[i])
            const c = Number(quote.close?.[i])
            const v = Number(quote.volume?.[i])
            if (isValidOhlcvCandle({ open: o, high: h, low: l, close: c, volume: v })) {
              candles.push({
                date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
                open: o,
                high: h,
                low: l,
                close: c,
                volume: Number.isFinite(v) ? v : 0,
              })
            }
          }

          if (candles.length < 30) {
            throw new Error(
              `Yahoo returned only ${candles.length} OHLCV rows for ${symbol} (need 30+).`
            )
          }
          return candles
        },
        { shouldRetry: isYahooRetryableError }
      )
    } catch (error) {
      lastError = error
    }
  }

  throw new Error(
    `Yahoo OHLCV fetch failed for ${symbol}: ${lastError?.message ?? 'unknown error'}`
  )
}

export async function fetchSymbolDataFromYahoo(symbol) {
  const yahooTicker = toYahooTicker(symbol)

  let lastError = null
  for (const host of YAHOO_HOSTS) {
    try {
      return await withYahooHttpRetries(
        async () => {
          await paceYahooRequest()
          const endpoint =
            `${host}/v8/finance/chart/${encodeURIComponent(yahooTicker)}` +
            '?range=2y&interval=1d&events=div,splits&includePrePost=false'
          const response = await fetchWithTimeout(
            endpoint,
            { headers: YAHOO_HTTP_HEADERS },
            12000
          )

          if (response.status === 429) {
            const err = new Error('Yahoo HTTP 429')
            const ra = parseRetryAfterMs(response)
            if (ra != null) {
              err.backoffMs = ra
            }
            throw err
          }

          if (!response.ok) {
            const { status } = response
            if (status === 502 || status === 503 || status === 504) {
              throw new Error(`Yahoo HTTP ${status}`)
            }
            throw new Error(`Yahoo HTTP ${status}`)
          }

          const payload = await response.json()
          const yahooError = payload?.chart?.error?.description
          if (yahooError) {
            throw new Error(yahooError)
          }

          return buildStockFromYahoo(symbol, payload)
        },
        { shouldRetry: isYahooRetryableError }
      )
    } catch (error) {
      lastError = error
    }
  }

  throw new Error(
    `Yahoo fetch failed for ${symbol}: ${lastError?.message ?? 'unknown error'}`
  )
}

export async function fetchCompanyProfileFromYahoo(symbol) {
  const yahooTicker = toYahooTicker(symbol)

  let lastError = null

  for (const host of YAHOO_HOSTS) {
    try {
      const value = await withYahooHttpRetries(
        async () => {
          await paceYahooRequest()
          const endpoint =
            `${host}/v10/finance/quoteSummary/${encodeURIComponent(yahooTicker)}` +
            '?modules=assetProfile,price'
          const response = await fetchWithTimeout(
            endpoint,
            { headers: YAHOO_HTTP_HEADERS },
            12000
          )

          if (response.status === 429) {
            const err = new Error('Yahoo HTTP 429')
            const ra = parseRetryAfterMs(response)
            if (ra != null) {
              err.backoffMs = ra
            }
            throw err
          }

          if (!response.ok) {
            const { status } = response
            if (status === 502 || status === 503 || status === 504) {
              throw new Error(`Yahoo HTTP ${status}`)
            }
            throw new Error(`Yahoo HTTP ${status}`)
          }

          const payload = await response.json()
          const profileError = payload?.quoteSummary?.error?.description
          if (profileError) {
            throw new Error(profileError)
          }

          const result = payload?.quoteSummary?.result?.[0]
          const assetProfile = result?.assetProfile ?? {}
          const price = result?.price ?? {}
          const summary = cleanBusinessSummary(assetProfile.longBusinessSummary ?? '')
          const foundedYear = extractFoundedYear(summary)
          const listedEpoch =
            Number(price.firstTradeDateEpochUtc) ||
            Number(price.firstTradeDateMilliseconds) / 1000
          const listedYear = Number.isFinite(listedEpoch)
            ? new Date(listedEpoch * 1000).getUTCFullYear()
            : null
          const startYear = foundedYear ?? listedYear
          const currentYear = new Date().getUTCFullYear()
          const yearsOperating =
            Number.isFinite(startYear) && startYear > 1800
              ? Math.max(1, currentYear - startYear)
              : null

          return {
            symbol,
            sector: assetProfile.sector ?? null,
            industry: assetProfile.industry ?? null,
            businessSummary: summary || null,
            foundedYear,
            listedYear,
            yearsOperating,
            yearsSource: foundedYear ? 'founded' : listedYear ? 'listed' : null,
            dataSource: 'yahoo',
          }
        },
        { shouldRetry: isYahooRetryableError }
      )

      return value
    } catch (error) {
      lastError = error
    }
  }

  throw new Error(
    `Profile fetch failed for ${symbol}: ${lastError?.message ?? 'unknown error'}`
  )
}
