export const DEFAULT_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'TSLA']

export const SORT_OPTIONS = [
    { id: 'trend', label: 'Trend' },
    { id: 'day', label: '1D' },
    { id: 'month', label: '1M' },
    { id: 'year', label: '1Y' },
]

export const TREND_LABELS = [
    'Early breakout',
    'Reversal',
    'Momentum',
    'Pullback bounce',
    'Downtrend',
    'Neutral',
]

export const COUNTRY_LABELS = [
    'Argentina',
    'EE.UU',
    'Europa',
    'China',
    'Reino Unido',
    'Canada',
    'Francia',
    'Brasil',
    'India',
    'Japon',
    'Taiwan',
]
export const INVESTMENT_GOALS = [
    { id: 'growth', label: 'Growth' },
    { id: 'dividends', label: 'Dividends' },
    { id: 'stability', label: 'Stability' },
    { id: 'value', label: 'Value opportunities' },
]

export const COUNTRY_SYMBOL_OVERRIDES = {
    MELI: 'Argentina',
    GLOB: 'Argentina',
    CRESY: 'Argentina',
    YPF: 'Argentina',
    TS: 'Europa',
    SHEL: 'Europa',
    NVO: 'Europa',
    TTE: 'Europa',
    BABA: 'China',
    BIDU: 'China',
    JD: 'China',
    PDD: 'China',
    TSM: 'Taiwan',
    BTI: 'Reino Unido',
    AZN: 'Reino Unido',
    HSBC: 'Reino Unido',
    LYG: 'Reino Unido',
    SHOP: 'Canada',
    RY: 'Canada',
    TD: 'Canada',
    BMO: 'Canada',
    ENB: 'Canada',
    CNI: 'Canada',
    CNQ: 'Canada',
    SU: 'Canada',
    TRP: 'Canada',
    BCE: 'Canada',
    TU: 'Canada',
    AEM: 'Canada',
    WCN: 'Canada',
    CP: 'Canada',
    CNR: 'Canada',
    EQNR: 'Europa',
    ERJ: 'Brasil',
    VALE: 'Brasil',
    ITUB: 'Brasil',
    NU: 'Brasil',
    HDB: 'India',
    IBN: 'India',
    INFY: 'India',
    WIT: 'India',
    NTDOY: 'Japon',
    SONY: 'Japon',
    TM: 'Japon',
    HMC: 'Japon',
}
export const TREND_MEANINGS = {
    'Early breakout':
        'Strong daily move with low monthly/yearly extension. Possible early-stage run.',
    Reversal:
        'Short-term momentum turning positive after weak long-term performance.',
    Momentum:
        'Positive day/month/year trend that still appears active.',
    'Pullback bounce':
        'Price bouncing in the short term during a broader monthly pullback.',
    Downtrend:
        'Negative direction across day, month, and year windows.',
    Neutral:
        'No clear directional edge from current day/month/year signals.',
}
