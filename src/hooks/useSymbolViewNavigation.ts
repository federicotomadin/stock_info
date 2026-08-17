import { useState } from 'react'
import { readFundamentalsSymbolFromUrl, readTechnicalSymbolFromUrl } from '../lib/urlSymbol'

/** Owns the fundamentals/technical detail-view URL state and the navigation helpers between them
 * and the screener. */
export function useSymbolViewNavigation() {
  const [fundamentalsSymbol, setFundamentalsSymbol] = useState(() => readFundamentalsSymbolFromUrl())
  const [technicalSymbol, setTechnicalSymbol] = useState(() => readTechnicalSymbolFromUrl())

  function handleBackToScreener() {
    setFundamentalsSymbol(null)
    setTechnicalSymbol(null)
    const url = new URL(import.meta.env.BASE_URL, window.location.origin)
    window.history.replaceState({}, '', `${url.pathname}${url.search}`)
  }

  function openFundamentalsInNewTab(symbol: string) {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '')
    const url = new URL(`${base}/stock/${symbol}`, window.location.origin)
    window.open(url.toString(), '_blank', 'noopener,noreferrer')
  }

  function openTechnicalInNewTab(symbol: string) {
    const url = new URL(window.location.href)
    url.searchParams.delete('fundamentals')
    url.searchParams.set('technical', '1')
    url.searchParams.set('symbol', symbol)
    window.open(url.toString(), '_blank', 'noopener,noreferrer')
  }

  return {
    fundamentalsSymbol,
    technicalSymbol,
    handleBackToScreener,
    openFundamentalsInNewTab,
    openTechnicalInNewTab,
  }
}
