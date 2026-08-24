// @ts-nocheck
import { fetchWithTimeout } from '../lib/http.js'
import {
  cleanBusinessSummary,
  extractFoundedYear,
  inferSectorFromIndustry,
  inferSectorIndustry,
} from '../lib/utils.js'

const WIKI_HEADERS = {
  'User-Agent': 'stock-info-local-app/1.0',
  Accept: 'application/json',
}

/** Rejects Wikipedia summaries that are clearly not a listed company (POI, geography, etc.). */
export function looksLikeNonCompanyWikipediaDescription(description = '') {
  const text = description.trim()
  if (!text) return false
  const lower = text.toLowerCase()
  if (
    /^(airport|train station|railway station|station|bridge|dam|river|mountain|building|prefecture|district|university|college|school|hospital|park|museum|highway|road|tunnel|lake|island|town|village|city)\b/i.test(
      text
    )
  ) {
    return true
  }
  if (/\bairport in\b/.test(lower)) return true
  if (/\bstation in\b/.test(lower) && !/\bcompany\b/.test(lower)) return true
  return false
}

export function cleanNameForWiki(name = '') {
  return name
    .replace(/\s*-\s*.*$/, '')
    .replace(
      /\b(inc|inc\.|corp|corporation|co|co\.|holdings|group|limited|ltd|plc|sa|se|nv|ag|company)\b/gi,
      ''
    )
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseWikidataYear(timeValue) {
  if (typeof timeValue !== 'string') {
    return null
  }

  const matched = timeValue.match(/([+-]?\d{4})-/)
  if (!matched) {
    return null
  }

  return Math.abs(Number(matched[1]))
}

export function extractTickerClaims(entity) {
  const claims = entity?.claims?.P249 ?? []
  return claims
    .map((claim) => claim?.mainsnak?.datavalue?.value)
    .filter(Boolean)
    .map((value) => String(value).toUpperCase())
}

export function extractIndustryEntityIds(entity) {
  const claims = entity?.claims?.P452 ?? []
  return claims
    .map((claim) => claim?.mainsnak?.datavalue?.value?.id)
    .filter(Boolean)
}

export function extractInceptionYear(entity) {
  const claim = entity?.claims?.P571?.[0]
  const time = claim?.mainsnak?.datavalue?.value?.time
  return parseWikidataYear(time)
}

export function extractEnWikipediaTitle(entity) {
  return entity?.sitelinks?.enwiki?.title ?? null
}

export async function fetchWikipediaSummaryByTitle(title) {
  const endpoint =
    'https://en.wikipedia.org/api/rest_v1/page/summary/' +
    encodeURIComponent(title.replaceAll(' ', '_'))
  const response = await fetchWithTimeout(endpoint, { headers: WIKI_HEADERS }, 8000)

  if (!response.ok) {
    throw new Error(`Wikipedia HTTP ${response.status}`)
  }

  const payload = await response.json()
  return {
    description: cleanBusinessSummary(payload.description ?? ''),
    extract: cleanBusinessSummary(payload.extract ?? ''),
  }
}

export async function fetchWikidataEntityById(entityId) {
  const endpoint = `https://www.wikidata.org/wiki/Special:EntityData/${entityId}.json`
  const response = await fetchWithTimeout(endpoint, { headers: WIKI_HEADERS }, 10000)

  if (!response.ok) {
    throw new Error(`Wikidata entity HTTP ${response.status}`)
  }

  const payload = await response.json()
  return payload?.entities?.[entityId] ?? null
}

export async function fetchWikidataLabelsByIds(ids) {
  if (!ids.length) {
    return {}
  }

  const endpoint =
    'https://www.wikidata.org/w/api.php?' +
    new URLSearchParams({
      action: 'wbgetentities',
      format: 'json',
      ids: ids.join('|'),
      languages: 'en',
      props: 'labels',
      origin: '*',
    }).toString()

  const response = await fetchWithTimeout(endpoint, { headers: WIKI_HEADERS }, 10000)

  if (!response.ok) {
    throw new Error(`Wikidata labels HTTP ${response.status}`)
  }

  const payload = await response.json()
  const result = {}
  for (const id of ids) {
    result[id] = payload?.entities?.[id]?.labels?.en?.value ?? null
  }
  return result
}

export function buildWikiCandidates(companyName = '') {
  const raw = companyName.replace(/\s*-\s*.*$/, '').trim()
  const cleaned = cleanNameForWiki(raw)

  return Array.from(
    new Set(
      [raw, `${raw} (company)`, cleaned, `${cleaned} (company)`].filter((value) =>
        value?.trim()
      )
    )
  )
}

export async function fetchCompanyProfileFromWikipedia(symbol, companyName) {
  const candidates = buildWikiCandidates(companyName)

  let lastError = null

  for (const candidate of candidates) {
    try {
      const endpoint =
        'https://en.wikipedia.org/api/rest_v1/page/summary/' +
        encodeURIComponent(candidate.replaceAll(' ', '_'))
      const response = await fetchWithTimeout(endpoint, { headers: WIKI_HEADERS }, 8000)

      if (!response.ok) {
        throw new Error(`Wikipedia HTTP ${response.status}`)
      }

      const payload = await response.json()
      const extract = cleanBusinessSummary(payload.extract ?? '')
      const description = cleanBusinessSummary(payload.description ?? '')
      const lowerDescription = description.toLowerCase()
      const likelyWrongEntity =
        companyName?.toLowerCase().includes('inc') &&
        (lowerDescription.includes('fruit') || lowerDescription.includes('species'))
      if (likelyWrongEntity) {
        throw new Error('Wrong Wikipedia entity match')
      }
      if (looksLikeNonCompanyWikipediaDescription(description)) {
        throw new Error('Wikipedia matched a non-company entity')
      }

      const text = `${description}. ${extract}`.trim()
      const foundedYear = extractFoundedYear(text)
      const yearsOperating = foundedYear
        ? Math.max(1, new Date().getUTCFullYear() - foundedYear)
        : null
      const inferred = inferSectorIndustry(text)

      return {
        symbol,
        sector: inferred.sector || 'Unknown',
        industry: inferred.industry || description || 'Unknown',
        businessSummary: extract || null,
        foundedYear,
        listedYear: null,
        yearsOperating,
        yearsSource: foundedYear ? 'founded' : null,
        dataSource: 'wikipedia',
      }
    } catch (error) {
      lastError = error
    }
  }

  throw new Error(
    `Wikipedia profile failed for ${symbol}: ${lastError?.message ?? 'unknown error'}`
  )
}

export async function fetchCompanyProfileFromWikidata(symbol, companyName) {
  const queryName = cleanNameForWiki(companyName) || symbol
  const searchEndpoint =
    'https://www.wikidata.org/w/api.php?' +
    new URLSearchParams({
      action: 'wbsearchentities',
      format: 'json',
      language: 'en',
      type: 'item',
      limit: '6',
      search: queryName,
      origin: '*',
    }).toString()

  const searchResponse = await fetchWithTimeout(searchEndpoint, { headers: WIKI_HEADERS }, 10000)

  if (!searchResponse.ok) {
    throw new Error(`Wikidata search HTTP ${searchResponse.status}`)
  }

  const searchPayload = await searchResponse.json()
  const candidates = searchPayload?.search ?? []
  if (!candidates.length) {
    throw new Error('No Wikidata entity candidates found')
  }

  const detailedCandidates = []
  for (const candidate of candidates) {
    const entity = await fetchWikidataEntityById(candidate.id)
    if (!entity) {
      continue
    }
    const tickers = extractTickerClaims(entity)
    const description = entity?.descriptions?.en?.value ?? candidate.description ?? ''
    const label = entity?.labels?.en?.value ?? candidate.label ?? ''

    const isLikelyCompany = description.toLowerCase().includes('company')
    let score = 0
    if (tickers.includes(symbol.toUpperCase())) {
      score += 8
    }
    if (isLikelyCompany) {
      score += 2
    }
    if (label.toLowerCase().includes(queryName.toLowerCase().split(' ')[0] ?? '')) {
      score += 1
    }

    if (tickers.includes(symbol.toUpperCase()) || isLikelyCompany) {
      detailedCandidates.push({
        score,
        candidate,
        entity,
      })
    }
  }

  if (!detailedCandidates.length) {
    throw new Error('No detailed Wikidata candidate found')
  }

  detailedCandidates.sort((a, b) => b.score - a.score)
  const selected = detailedCandidates[0].entity
  const inceptionYear = extractInceptionYear(selected)
  const industryIds = extractIndustryEntityIds(selected)
  const industryLabels = await fetchWikidataLabelsByIds(industryIds.slice(0, 3))
  const industry =
    industryLabels[industryIds[0]] ??
    selected?.descriptions?.en?.value ??
    detailedCandidates[0].candidate?.description ??
    'Unknown'
  const sector = inferSectorFromIndustry(industry)

  const enWikiTitle = extractEnWikipediaTitle(selected)
  let summary = null
  if (enWikiTitle) {
    try {
      const wiki = await fetchWikipediaSummaryByTitle(enWikiTitle)
      summary = wiki.extract || wiki.description || null
    } catch {
      summary = selected?.descriptions?.en?.value ?? null
    }
  } else {
    summary = selected?.descriptions?.en?.value ?? null
  }

  return {
    symbol,
    sector: sector || 'Unknown',
    industry: industry || 'Unknown',
    businessSummary: summary ? cleanBusinessSummary(summary) : null,
    foundedYear: inceptionYear,
    listedYear: null,
    yearsOperating: inceptionYear
      ? Math.max(1, new Date().getUTCFullYear() - inceptionYear)
      : null,
    yearsSource: inceptionYear ? 'founded' : null,
    dataSource: 'wikidata',
  }
}
