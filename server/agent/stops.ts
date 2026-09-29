const toCents = (value: number): number => Math.round(value * 100) / 100

export interface StopPlanInput {
  avgCost: number
  originalStop: number
  currentStop: number
  currentPrice: number
  supports: number[]
  sma20: number | null
  downtrend: boolean
}

export interface StopPlan {
  stop: number
  reason: 'breakeven' | 'support' | 'sma20' | 'downtrend'
}

/**
 * Never lowers a stop. Raises it to break-even after +1R, then trails under support / SMA20.
 * On a downtrend, tightens to ~1.5% below the last price.
 */
export function plannedStop(input: StopPlanInput): StopPlan | null {
  const { avgCost, originalStop, currentStop, currentPrice, supports, sma20, downtrend } = input
  if (!(currentPrice > 0) || !(avgCost > 0)) return null

  const ceiling = toCents(currentPrice * 0.995)
  const candidates: Array<{ stop: number; reason: StopPlan['reason'] }> = []

  const initialRisk = avgCost - originalStop
  if (initialRisk > 0 && currentPrice >= avgCost + initialRisk) {
    candidates.push({ stop: toCents(avgCost * 1.002), reason: 'breakeven' })
  }

  const nearestSupport = supports.filter((level) => level < currentPrice).sort((a, b) => b - a)[0]
  if (nearestSupport != null) {
    candidates.push({ stop: toCents(nearestSupport * 0.995), reason: 'support' })
  }

  if (sma20 != null && sma20 < currentPrice) {
    candidates.push({ stop: toCents(sma20 * 0.995), reason: 'sma20' })
  }

  if (downtrend) {
    candidates.push({ stop: toCents(currentPrice * 0.985), reason: 'downtrend' })
  }

  const best = candidates
    .map((candidate) => ({ ...candidate, stop: Math.min(candidate.stop, ceiling) }))
    .filter((candidate) => candidate.stop > currentStop + 0.009 && candidate.stop < currentPrice)
    .sort((a, b) => b.stop - a.stop)[0]

  return best ?? null
}

export function defaultProtectiveStop(price: number, avgCost: number, defaultStopPct: number): number {
  const fromCost = avgCost > 0 ? avgCost * (1 - defaultStopPct / 100) : 0
  const fromPrice = price * (1 - defaultStopPct / 100)
  return toCents(Math.min(fromCost || fromPrice, fromPrice))
}
