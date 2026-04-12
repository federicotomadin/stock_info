import {numberOrFallback} from "./utlils.js";

export const horizonByTrendLabel = (label, profile) => {
    if (label === 'Early breakout' || label === 'Reversal') {
        return profile === 'Aggressive' ? '1-3 months' : '3-6 months'
    }
    if (label === 'Momentum') {
        return profile === 'Conservative' ? '6-12 months' : '3-9 months'
    }
    if (label === 'Pullback bounce') {
        return profile === 'Conservative' ? '3-6 months' : '1-3 months'
    }
    if (label === 'Neutral') {
        return '6-12 months'
    }
    return 'Watchlist (avoid entry for now)'
}

export const recommendationScore = (stock, profile, goals) => {
    const day = numberOrFallback(stock.dayChange, -100)
    const month = numberOrFallback(stock.monthChange, -100)
    const year = numberOrFallback(stock.yearChange, -100)
    const trendScore = stock.trend?.score ?? 0
    const trendLabel = stock.trend?.label ?? 'Neutral'

    let score = trendScore

    if (profile === 'Conservative') {
        score += month * 0.6 + year * 0.8 - Math.abs(day) * 0.5
        if (trendLabel === 'Downtrend') score -= 12
        if (trendLabel === 'Momentum') score += 4
    } else if (profile === 'Aggressive') {
        score += day * 1.2 + month * 0.45 + year * 0.2
        if (trendLabel === 'Early breakout' || trendLabel === 'Reversal') score += 6
        if (trendLabel === 'Downtrend') score -= 6
    } else {
        score += day * 0.55 + month * 0.65 + year * 0.45
        if (trendLabel === 'Momentum' || trendLabel === 'Reversal') score += 3
    }

    if (goals.includes('dividends')) {
        score += year > 0 ? 3 : -2
        score -= Math.abs(day) * 0.25
    }
    if (goals.includes('stability')) {
        score -= Math.abs(day) * 0.4
        score += month > 0 ? 2 : -1
    }
    if (goals.includes('growth')) {
        score += month * 0.35 + year * 0.35
    }
    if (goals.includes('value')) {
        if (trendLabel === 'Reversal' || trendLabel === 'Pullback bounce') {
            score += 4
        }
    }

    return score
}
