import { useCallback, useRef, useState } from 'react'
import { apiEndpoint } from '../services/servicesAPI.ts'
import type { CompanyProfile } from '../types/stock'

/**
 * Lazily fetches sector/industry/business-summary for a ticker the first time it's hovered,
 * then caches it client-side (a plain Map ref, not React state, so cache hits never re-render).
 *
 * Deliberately reuses the existing deterministic /api/company-profiles pipeline (Finnhub +
 * Wikipedia/Wikidata fallback, 48h server-side cache) instead of an LLM call per row: querying
 * Groq/Gemini on every hover across a 6,000+ ticker table would be slow and would burn through
 * the same free-tier rate limits we already have to manage for FMP.
 */
export function useTickerHoverProfiles() {
  const cacheRef = useRef<Map<string, CompanyProfile | null>>(new Map())
  const pendingRef = useRef<Set<string>>(new Set())
  const [, forceRerender] = useState(0)

  const requestProfile = useCallback((symbol: string) => {
    if (!symbol || cacheRef.current.has(symbol) || pendingRef.current.has(symbol)) {
      return
    }
    pendingRef.current.add(symbol)

    void (async () => {
      try {
        const endpoint = apiEndpoint('/api/company-profiles')
        endpoint.searchParams.set('symbols', symbol)
        const response = await fetch(endpoint)
        const payload = (await response.json()) as { data?: CompanyProfile[] }
        cacheRef.current.set(symbol, payload.data?.[0] ?? null)
      } catch {
        cacheRef.current.set(symbol, null)
      } finally {
        pendingRef.current.delete(symbol)
        // Only the tooltip text needs the fresh data on the next render — a lightweight
        // counter bump is enough, this component tree is already paginated (~page size rows).
        forceRerender((n) => n + 1)
      }
    })()
  }, [])

  const getProfile = useCallback(
    (symbol: string): CompanyProfile | null => cacheRef.current.get(symbol) ?? null,
    []
  )

  return { getProfile, requestProfile }
}
