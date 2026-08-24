import 'dotenv/config'
import path from 'node:path'

export const PORT = Number(process.env.PORT || 9001)

export const MAX_SYMBOLS = 120
export const SYMBOL_CONCURRENCY = 4
export const FETCH_RETRIES = 2
export const CACHE_TTL_MS = 5 * 60 * 1000

export const MARKET_SNAPSHOT_CACHE_TTL_MS = 20 * 60 * 1000
export const SNAPSHOT_BATCH_SIZE = 120
export const SNAPSHOT_BATCH_CONCURRENCY = 6
export const SNAPSHOT_SYMBOL_CONCURRENCY = 8
export const SNAPSHOT_CACHE_FILE = path.join(process.cwd(), '.cache', 'market-snapshot.json')

export const PROFILE_CACHE_TTL_MS = 48 * 60 * 60 * 1000

export const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY?.trim()
export const FMP_API_KEY = process.env.FMP_API_KEY?.trim()

// Fundamentals change at most quarterly; a long TTL keeps FMP's free quota from being
// burned by re-visits or dev-server restarts within the same day.
export const FMP_FUNDAMENTALS_CACHE_TTL_MS = 24 * 60 * 60 * 1000
export const FMP_FUNDAMENTALS_CACHE_FILE = path.join(process.cwd(), '.cache', 'fmp-fundamentals.json')

export const AI_PROVIDER = (process.env.AI_PROVIDER || 'gemini').trim().toLowerCase()
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim()
export const GEMINI_MODEL = (process.env.GEMINI_MODEL || 'gemini-2.0-flash').trim()
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY?.trim()
export const CLAUDE_MODEL = (process.env.CLAUDE_MODEL || 'claude-sonnet-4-5').trim()
export const GROQ_API_KEY = process.env.GROQ_API_KEY?.trim()
// llama-3.3-70b-versatile was decommissioned by Groq on 2026-08-16; gpt-oss-120b is their
// recommended replacement (see console.groq.com/docs/deprecations).
export const GROQ_MODEL = (process.env.GROQ_MODEL || 'openai/gpt-oss-120b').trim()

export const TECHNICAL_ANALYSIS_CACHE_TTL_MS = 24 * 60 * 60 * 1000
export const TECHNICAL_ANALYSIS_CACHE_FILE = path.join(process.cwd(), '.cache', 'technical-analysis.json')

export const UNIVERSE_TTL_MS = 24 * 60 * 60 * 1000
