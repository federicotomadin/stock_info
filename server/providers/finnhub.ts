// @ts-nocheck
import { FINNHUB_API_KEY } from '../config.js'
import { fetchWithTimeout } from '../lib/http.js'
import { cleanBusinessSummary, inferSectorFromIndustry, numOrNull } from '../lib/utils.js'

const FINNHUB_HEADERS = {
  'User-Agent': 'stock-info-local-app/1.0',
  Accept: 'application/json',
}

export async function fetchCompanyProfileFromFinnhub(symbol) {
  if (!FINNHUB_API_KEY) {
    throw new Error('Finnhub API key is not configured')
  }

  const endpoint =
    'https://finnhub.io/api/v1/stock/profile2?' +
    new URLSearchParams({
      symbol,
      token: FINNHUB_API_KEY,
    }).toString()
  const response = await fetchWithTimeout(endpoint, { headers: FINNHUB_HEADERS }, 10000)

  if (!response.ok) {
    throw new Error(`Finnhub HTTP ${response.status}`)
  }

  const payload = await response.json()
  if (!payload || typeof payload !== 'object' || !Object.keys(payload).length) {
    throw new Error(`Finnhub profile not found for ${symbol}`)
  }

  const industry = cleanBusinessSummary(payload.finnhubIndustry ?? '') || null
  const listedYear = payload.ipo?.slice(0, 4) ? Number(payload.ipo.slice(0, 4)) : null
  const currentYear = new Date().getUTCFullYear()
  const yearsOperating =
    Number.isFinite(listedYear) && listedYear > 1800
      ? Math.max(1, currentYear - listedYear)
      : null
  const sector = industry ? inferSectorFromIndustry(industry) : 'Unknown'

  return {
    symbol,
    companyName: payload.name ?? null,
    sector: sector || 'Unknown',
    industry: industry || 'Unknown',
    businessSummary: null,
    foundedYear: null,
    listedYear,
    yearsOperating,
    yearsSource: listedYear ? 'listed' : null,
    dataSource: 'finnhub',
  }
}

export function fetchFinnhubMetrics(symbol) {
  if (!FINNHUB_API_KEY) {
    throw new Error('Finnhub API key is not configured')
  }

  const base = 'https://finnhub.io/api/v1'
  const metricUrl =
    `${base}/stock/metric?` +
    new URLSearchParams({ symbol, metric: 'all', token: FINNHUB_API_KEY }).toString()
  const quoteUrl =
    `${base}/quote?` +
    new URLSearchParams({ symbol, token: FINNHUB_API_KEY }).toString()

  return Promise.all([
    fetchWithTimeout(metricUrl, { headers: FINNHUB_HEADERS }, 10000),
    fetchWithTimeout(quoteUrl, { headers: FINNHUB_HEADERS }, 10000),
  ])
}

export function mapFinnhubFundamentals(symbol, metricPayload, quotePayload) {
  const m = metricPayload?.metric ?? {}
  if (!m || typeof m !== 'object' || !Object.keys(m).length) {
    throw new Error(`Finnhub metric not found for ${symbol}`)
  }

  const price = numOrNull(quotePayload?.c)
  const mktCap = numOrNull(m.marketCapitalization)
  const shares = price && mktCap ? mktCap / price : null

  const pe = numOrNull(m.peTTM) ?? numOrNull(m.peBasicExclExtraTTM)
  const pb = numOrNull(m.pb) ?? numOrNull(m.pbQuarterly)
  const roe = numOrNull(m.roeTTM)
  const roic = numOrNull(m.roiTTM)
  const evToEbitda = numOrNull(m.evEbitdaTTM)
  const debtToEquity =
    numOrNull(m['totalDebt/totalEquityQuarterly']) ?? numOrNull(m['totalDebt/totalEquityAnnual'])
  const dividendIndicated = numOrNull(m.dividendIndicatedAnnual)
  const dividendYield = price && dividendIndicated != null ? dividendIndicated / price : null
  const currentRatio = numOrNull(m.currentRatioQuarterly) ?? numOrNull(m.currentRatioAnnual)
  const priceToFcf = numOrNull(m.pfcfShareTTM)
  const fcfYield = priceToFcf ? 1 / priceToFcf : null

  const keyMetricsTtm = {
    peRatio: pe,
    peRatioTTM: pe,
    priceToEarningsRatioTTM: pe,
    priceEarningsRatioTTM: pe,
    pbRatio: pb,
    ptbRatio: pb,
    priceToBookRatioTTM: pb,
    roe,
    roeTTM: roe,
    returnOnEquityTTM: roe,
    roic,
    roicTTM: roic,
    returnOnInvestedCapitalTTM: roic,
    enterpriseValueOverEBITDATTM: evToEbitda,
    evToEBITDATTM: evToEbitda,
    enterpriseValueMultipleTTM: evToEbitda,
    debtToEquity,
    debtToEquityTTM: debtToEquity,
    debtToEquityRatioTTM: debtToEquity,
    dividendYieldTTM: dividendYield,
    dividendYield,
    dividendYieldPercentage: dividendYield,
    freeCashFlowYieldTTM: fcfYield,
    freeCashFlowYield: fcfYield,
    fcfYieldTTM: fcfYield,
    priceToFreeCashFlowRatioTTM: priceToFcf,
    currentRatioTTM: currentRatio,
  }

  const ratiosTtm = {
    grossProfitMarginTTM: numOrNull(m.grossMarginTTM),
    grossProfitMargin: numOrNull(m.grossMarginTTM),
    operatingProfitMarginTTM: numOrNull(m.operatingMarginTTM),
    operatingProfitMargin: numOrNull(m.operatingMarginTTM),
    netProfitMarginTTM: numOrNull(m.netProfitMarginTTM),
    netProfitMargin: numOrNull(m.netProfitMarginTTM),
    currentRatioTTM: currentRatio,
    interestCoverageTTM: numOrNull(m.netInterestCoverageTTM),
    interestCoverageRatioTTM: numOrNull(m.netInterestCoverageTTM),
    assetTurnoverTTM: numOrNull(m.assetTurnoverTTM),
    priceToFreeCashFlowRatioTTM: priceToFcf,
  }

  const revenuePerShare = numOrNull(m.revenuePerShareAnnual)
  const epsAnnual = numOrNull(m.epsBasicExclExtraItemsAnnual) ?? numOrNull(m.epsAnnual)
  const incomeStatementAnnual = []
  if (shares) {
    incomeStatementAnnual.push({
      calendarYear: null,
      revenue: revenuePerShare != null ? revenuePerShare * shares : null,
      netIncome: epsAnnual != null ? epsAnnual * shares : null,
      eps: epsAnnual,
    })
  }

  let dcf = null
  if (priceToFcf && priceToFcf > 0 && price) {
    const fcfPerShare = price / priceToFcf
    const growthRate = 0.025
    const discountRate = 0.1
    const dcfPerShare = (fcfPerShare * (1 + growthRate)) / (discountRate - growthRate)
    dcf = {
      dcf: Number(dcfPerShare.toFixed(2)),
      'Stock Price': price,
      stockPrice: price,
    }
  }

  return {
    symbol,
    dataSource: 'finnhub',
    profile: null,
    profileError: null,
    keyMetricsTtm,
    keyMetricsTtmError: null,
    ratiosTtm,
    ratiosTtmError: null,
    incomeStatementAnnual,
    incomeStatementError: null,
    balanceSheetAnnual: [],
    balanceSheetError: null,
    cashFlowAnnual: [],
    cashFlowError: null,
    discountedCashFlow: dcf,
    discountedCashFlowError: null,
  }
}

export async function fetchFinnhubFundamentalsBundle(symbol) {
  const [metricRes, quoteRes] = await fetchFinnhubMetrics(symbol)

  if (!metricRes.ok) {
    throw new Error(`Finnhub metric HTTP ${metricRes.status}`)
  }
  if (!quoteRes.ok) {
    throw new Error(`Finnhub quote HTTP ${quoteRes.status}`)
  }

  const metricPayload = await metricRes.json()
  const quotePayload = await quoteRes.json()
  return mapFinnhubFundamentals(symbol, metricPayload, quotePayload)
}
