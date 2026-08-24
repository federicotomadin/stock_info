import { FINNHUB_API_KEY, PROFILE_CACHE_TTL_MS, SYMBOL_CONCURRENCY } from './config.js'
import { fetchCompanyProfileFromFinnhub } from './providers/finnhub.js'
import { fetchCompanyProfileFromYahoo } from './providers/yahoo.js'
import {
  fetchCompanyProfileFromWikipedia,
  fetchCompanyProfileFromWikidata,
} from './providers/wiki.js'

/** Curated fundamentals when public APIs resolve the wrong Wikipedia/Wikidata entity. */
const PROFILE_SYMBOL_OVERRIDES = {
  AXTI: {
    sector: 'Technology',
    industry: 'Semiconductor materials & compound substrates',
    businessSummary:
      'AXT, Inc. designs and manufactures compound semiconductor substrates (GaAs, InP, Ge) and related specialty materials — a niche but strategic link in the global chip and photonics supply chain.',
    dataSource: 'curated',
  },
}

const profileCache = new Map()

function applyProfileOverride(symbol, value) {
  const key = String(symbol ?? '').toUpperCase()
  const override = PROFILE_SYMBOL_OVERRIDES[key]
  if (!override || !value) {
    return value
  }
  return {
    ...value,
    sector: override.sector ?? value.sector,
    industry: override.industry ?? value.industry,
    businessSummary: override.businessSummary ?? value.businessSummary,
    dataSource: override.dataSource ?? value.dataSource,
  }
}

export async function fetchCompanyProfile(symbol, companyName) {
  const cached = profileCache.get(symbol)
  if (cached && Date.now() - cached.savedAt < PROFILE_CACHE_TTL_MS) {
    return applyProfileOverride(symbol, cached.value)
  }

  let value
  const companyNameHint = companyName ?? symbol

  if (FINNHUB_API_KEY) {
    try {
      value = await fetchCompanyProfileFromFinnhub(symbol)
      try {
        const wiki = await fetchCompanyProfileFromWikipedia(
          symbol,
          value.companyName ?? companyNameHint
        )
        value = {
          ...value,
          sector: value.sector === 'Unknown' ? wiki.sector : value.sector,
          industry: value.industry === 'Unknown' ? wiki.industry : value.industry,
          businessSummary: wiki.businessSummary ?? value.businessSummary,
          foundedYear: value.foundedYear ?? wiki.foundedYear,
          yearsOperating: value.yearsOperating ?? wiki.yearsOperating,
          yearsSource: value.yearsSource ?? wiki.yearsSource,
          dataSource: 'finnhub+wikipedia',
        }
      } catch {
        // Keep Finnhub data even if enrichment fails.
      }
    } catch {
      value = null
    }
  } else {
    value = null
  }

  if (!value) {
    try {
      value = await fetchCompanyProfileFromYahoo(symbol)
    } catch {
      try {
        value = await fetchCompanyProfileFromWikipedia(symbol, companyNameHint)
      } catch {
        value = await fetchCompanyProfileFromWikidata(symbol, companyNameHint)
      }
    }
  }

  const finalValue = applyProfileOverride(symbol, value)
  profileCache.set(symbol, { value: finalValue, savedAt: Date.now() })
  return finalValue
}

export async function settleProfilesWithConcurrency(symbols, companyNameBySymbol) {
  const results = Array(symbols.length)
  let cursor = 0

  async function runWorker() {
    while (cursor < symbols.length) {
      const currentIndex = cursor
      cursor += 1
      const symbol = symbols[currentIndex]

      try {
        const companyName = companyNameBySymbol.get(symbol) ?? symbol
        const value = await fetchCompanyProfile(symbol, companyName)
        results[currentIndex] = { status: 'fulfilled', value }
      } catch (reason) {
        results[currentIndex] = {
          status: 'rejected',
          reason: new Error(reason?.message ?? `Could not load profile for ${symbol}`),
        }
      }
    }
  }

  const workerCount = Math.min(SYMBOL_CONCURRENCY, symbols.length)
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()))
  return results
}
