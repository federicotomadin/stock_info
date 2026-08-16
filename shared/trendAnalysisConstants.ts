/** Shared trend scoring thresholds — keep server/db/trend.ts and client analyzeTrend in sync. */
export const TREND_ANALYSIS = {
  missingChangeFallback: -100,
  yearScoreCap: 80,
  scoreWeights: {
    day: 0.55,
    month: 0.35,
    year: 0.1,
  },
  patterns: {
    earlyBreakout: {
      thresholds: { dayMin: 1.1, monthMax: 4, yearMax: 18 },
      scoreAdjustment: 10,
    },
    reversal: {
      thresholds: { dayMin: 0.4, monthMin: 0, yearMax: 0 },
      scoreAdjustment: 14,
    },
    momentum: {
      thresholds: { dayMin: 0, monthMin: 6, yearMin: 12 },
      scoreAdjustment: 5,
    },
    downtrend: {
      thresholds: { dayMax: 0, monthMax: 0, yearMax: 0 },
      scoreAdjustment: -8,
    },
    pullbackBounce: {
      thresholds: { dayMin: 0, monthMax: 0, yearMin: 0 },
      scoreAdjustment: 3,
    },
  },
} as const
