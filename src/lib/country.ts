import { COUNTRY_SYMBOL_OVERRIDES } from '../models/constants'
import type { CountryLabel, EnrichedStock } from '../types/stock'

/** Infers a stock's country from known ticker overrides, company name keywords, exchange, or
 * ticker suffix (e.g. ".SA" → Brasil), falling back to "EE.UU". */
export function detectCountry(stock: Partial<EnrichedStock>): CountryLabel {
  const symbol = (stock.symbol ?? '').toUpperCase()
  const exchange = (stock.exchange ?? '').toUpperCase()
  const name = (stock.name ?? '').toUpperCase()

  if (COUNTRY_SYMBOL_OVERRIDES[symbol]) {
    return COUNTRY_SYMBOL_OVERRIDES[symbol]
  }

  if (
    name.includes('MERCADOLIBRE') ||
    name.includes('SATELLOGIC') ||
    name.includes('ARGENTINA') ||
    name.includes('ARGENTINE')
  ) {
    return 'Argentina'
  }

  if (name.includes('CHINA') || name.includes('CHINESE')) return 'China'
  if (name.includes('TAIWAN') || name.includes('TAIWANESE')) return 'Taiwan'
  if (name.includes('CANADA') || name.includes('CANADIAN')) return 'Canada'
  if (name.includes('BRAZIL') || name.includes('BRASIL')) return 'Brasil'
  if (name.includes('INDIA') || name.includes('INDIAN')) return 'India'
  if (name.includes('JAPAN') || name.includes('JAPANESE')) return 'Japon'
  if (name.includes('FRANCE') || name.includes('FRENCH')) return 'Francia'
  if (name.includes('UNITED KINGDOM') || name.includes('BRITISH')) return 'Reino Unido'

  if (
    exchange.includes('NASDAQ') ||
    exchange.includes('NYSE') ||
    exchange.includes('AMEX') ||
    exchange.includes('CBOE') ||
    exchange.includes('IEX')
  ) {
    return 'EE.UU'
  }

  if (symbol.endsWith('.BA')) return 'Argentina'
  if (symbol.endsWith('.TO') || symbol.endsWith('.V')) return 'Canada'
  if (symbol.endsWith('.TW') || symbol.endsWith('.TWO')) return 'Taiwan'
  if (symbol.endsWith('.SS') || symbol.endsWith('.SZ') || symbol.endsWith('.HK')) {
    return 'China'
  }
  if (symbol.endsWith('.L')) return 'Reino Unido'
  if (symbol.endsWith('.PA')) return 'Francia'
  if (symbol.endsWith('.SA')) return 'Brasil'
  if (symbol.endsWith('.NS') || symbol.endsWith('.BO')) return 'India'
  if (symbol.endsWith('.T')) return 'Japon'

  if (
    symbol.endsWith('.DE') ||
    symbol.endsWith('.MI') ||
    symbol.endsWith('.AS') ||
    symbol.endsWith('.MC') ||
    symbol.endsWith('.SW') ||
    symbol.endsWith('.ST') ||
    symbol.endsWith('.CO') ||
    symbol.endsWith('.HE') ||
    symbol.endsWith('.OL') ||
    symbol.endsWith('.VI') ||
    symbol.endsWith('.PR') ||
    symbol.endsWith('.WA') ||
    symbol.endsWith('.AT')
  ) {
    return 'Europa'
  }

  return 'EE.UU'
}
