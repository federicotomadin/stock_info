export const RECENTLY_LISTED_DETAIL =
  'Recently listed — less than one year of trading history, trend not confirmed yet.'

/** Chase-risk guards applied to recommendations only; trend labels stay untouched. */
export const RECOMMENDATION_GUARDS = {
  // Momentum/Early breakout with RSI14 above this is overextended and prone to next-day pullbacks.
  maxRsiForBullishEntry: 75,
  // Momentum with a monthly move above this (%) is a blow-off run, not a sustainable trend.
  maxMomentumMonthChange: 40,
  // Mid cap and up (USD). Smaller names gap harder and IBKR may block opening trades in them.
  minMarketCapUsd: 2_000_000_000,
} as const

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
  // Optional technical confirmation — only applied when rsi14/sma20/sma50 are available
  // (derived for free from the daily-close series already fetched for % change math).
  // These nudge the score/tone within the same label, they never change which label wins,
  // so existing filters keyed on TrendLabel strings keep working unchanged.
  technical: {
    // Golden/death cross bias: small deterministic tilt from the SMA20 vs SMA50 relationship.
    smaCrossBias: 4,
    // Classic 50/200 golden/death cross — weaker weight since it lags more.
    smaLongCrossBias: 3,
    // Momentum/Early breakout confirmed by % change but RSI already very overbought is a
    // higher-risk chase — soften the score and flag caution instead of outright bullish.
    rsiOverboughtThreshold: 75,
    rsiOverboughtPenaltyPerPoint: 0.6,
    // Downtrend with RSI already deeply oversold may be closer to a bounce than fresh weakness —
    // soften the penalty slightly without relabeling it (still a downtrend for risk filters).
    rsiOversoldThreshold: 25,
    rsiOversoldReliefPerPoint: 0.4,
  },
} as const
