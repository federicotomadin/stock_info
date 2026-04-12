import {MAX_SYMBOLS} from "./App.jsx";
import {TREND_MEANINGS} from "./models/constants.js";

export const parseSymbols = (rawInput) => {
    const parsed = rawInput
        .split(',')
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean)

    return Array.from(new Set(parsed)).slice(0, MAX_SYMBOLS)
}

export const formatPercent = (value) => {
    if (value === null || Number.isNaN(value)) {
        return 'N/A'
    }

    return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

export const metricClass = (value) => {
    if (value === null || Number.isNaN(value)) {
        return ''
    }

    if (value > 0) {
        return 'positive'
    }

    if (value < 0) {
        return 'negative'
    }

    return 'neutral'
}

export const numberOrFallback = (value, fallback = 0) => {
    if (value === null || Number.isNaN(value)) {
        return fallback
    }

    return value
}

export const trendTooltip = (label, detail) => {
    return `${label}: ${TREND_MEANINGS[label] ?? detail}`
}

export const cleanCompanyName = (name) => {
    if (!name) {
        return null
    }

    return name
        .replace(/\s*-\s*Common Stock$/i, '')
        .replace(/\s*Common Stock$/i, '')
        .trim()
}
