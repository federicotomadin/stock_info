import { useCallback, useEffect, useRef, useState } from 'react'
import { MANUAL_STOCKS_DEBOUNCE_MS } from '../constants/app'
import { apiEndpoint, hasApiOriginConfigured } from '../services/servicesAPI.ts'
import { parseSymbols } from '../utils'
import type { AppMode, StockQuote } from '../types/stock'

interface UseManualTickerFetchParams {
  symbolsInput: string
  mode: AppMode
  setStocks: (stocks: StockQuote[]) => void
  setError: (error: string) => void
  setWarning: (warning: string) => void
}

export function useManualTickerFetch({
  symbolsInput,
  mode,
  setStocks,
  setError,
  setWarning,
}: UseManualTickerFetchParams) {
  const [manualStocksLoading, setManualStocksLoading] = useState(false)
  const requestIdRef = useRef(0)

  const fetchManualStocks = useCallback(
    async (rawInput: string, { fromSubmit = false } = {}) => {
      const symbols = parseSymbols(rawInput)

      if (!symbols.length) {
        requestIdRef.current += 1
        setManualStocksLoading(false)
        if (fromSubmit) {
          setError('Enter at least one valid ticker. Example: AAPL, MSFT, NVDA')
        } else {
          setError('')
        }
        setStocks([])
        setWarning('')
        return
      }

      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId

      setManualStocksLoading(true)
      setStocks([])
      setError('')
      setWarning('')
      try {
        const endpoint = apiEndpoint('/api/stocks')
        endpoint.searchParams.set('symbols', symbols.join(','))
        const response = await fetch(endpoint)
        const payload = await response.json()

        if (requestIdRef.current !== requestId) {
          return
        }

        if (!response.ok) {
          setStocks([])
          setError(payload.error ?? 'Could not load stock data.')
          return
        }

        setStocks(payload.data ?? [])

        if (!payload.data?.length) {
          const firstFailure = payload.failed?.[0] ?? ''
          const isRateLimit = /\b429\b|rate limit|too many requests/i.test(firstFailure)
          setError(
            isRateLimit
              ? `Yahoo Finance is rate-limiting requests right now (HTTP 429). This is temporary. Try again in a minute, or set FMP_API_KEY in the server .env to avoid depending on Yahoo. Tickers requested: ${symbols.join(', ')}`
              : firstFailure || 'Could not load stock data. Please try again in a few seconds.'
          )
          return
        }

        if (payload.failed?.length) {
          setWarning('Partial results loaded. Some tickers may be invalid.')
        }
      } catch {
        if (requestIdRef.current !== requestId) {
          return
        }
        setStocks([])
        setError(
          import.meta.env.PROD && !hasApiOriginConfigured()
            ? 'No API URL in this build. Set VITE_API_ORIGIN (https backend URL) in GitHub and redeploy.'
            : 'Could not connect to local server. Run npm run dev to start frontend and API.'
        )
      } finally {
        if (requestIdRef.current === requestId) {
          setManualStocksLoading(false)
        }
      }
    },
    [setError, setStocks, setWarning]
  )

  // Full market fetch owns `stocks`/`error`/`warning` while in universe mode; drop stale requests here.
  useEffect(() => {
    if (mode !== 'manual') {
      requestIdRef.current += 1
      setManualStocksLoading(false)
    }
  }, [mode])

  useEffect(() => {
    if (mode !== 'manual') {
      return
    }

    const timeoutId = window.setTimeout(() => {
      void fetchManualStocks(symbolsInput, { fromSubmit: false })
    }, MANUAL_STOCKS_DEBOUNCE_MS)

    return () => window.clearTimeout(timeoutId)
  }, [mode, symbolsInput, fetchManualStocks])

  return { manualStocksLoading, fetchManualStocks }
}
