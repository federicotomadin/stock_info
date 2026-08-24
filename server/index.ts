// @ts-nocheck
import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import http from 'node:http'

import { isDatabaseEnabled } from './db/pool.js'
import { initSchema } from './db/schema.js'
import { getSyncStatus, queryScreener } from './db/queries.js'
import { getSyncProgress, isSyncRunning, scheduleMarketSync, syncMarketData } from './db/sync.js'
import { sendWeeklyDigest, subscribeToNewsletter, unsubscribeFromNewsletter } from './newsletter.js'

import {
  FMP_API_KEY,
  FMP_FUNDAMENTALS_CACHE_FILE,
  FMP_FUNDAMENTALS_CACHE_TTL_MS,
  PORT,
  SNAPSHOT_BATCH_SIZE,
  TECHNICAL_ANALYSIS_CACHE_FILE,
  TECHNICAL_ANALYSIS_CACHE_TTL_MS,
} from './config.js'
import { parseAiAnalysisJson, parseSymbols } from './lib/utils.js'
import { loadMapCacheFromDisk, saveMapCacheToDisk } from './lib/cache.js'
import { sanitizeOhlcvCandles } from './lib/stock.js'
import { computeTechnicalSnapshot } from './lib/indicators.js'
import {
  buildTechnicalAnalysisPrompt,
  callAiAnalysis,
  hasAnyAiKey,
  resolveActiveAiProvider,
} from './ai.js'
import { settleProfilesWithConcurrency } from './companyProfile.js'
import { fetchFundamentalsBundle, fmpFundamentalsCache } from './fundamentals.js'
import {
  fetchOhlcv,
  generateCandleChartPng,
  technicalAnalysisCache,
} from './technicalAnalysis.js'
import {
  fetchMarketUniverse,
  fetchSymbolData,
  getMarketSnapshotIfFresh,
  getOrBuildMarketSnapshot,
  loadMarketSnapshotFromDisk,
  marketSnapshotBuildPromise,
  scheduleMarketSnapshotWarmup,
  settleSymbolsWithConcurrency,
} from './marketData.js'

const app = express()

app.use(cors())
app.use(express.json())

app.get('/', (_req, res) => {
  res.json({
    service: 'stock-info-api',
    ok: true,
    message:
      'API is running. Use /api/health, /api/universe, /api/stocks, /api/company-profiles, /api/fmp/fundamentals, /api/technical-analysis',
  })
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/stocks', async (req, res) => {
  const symbols = parseSymbols(req.query.symbols)

  if (!symbols.length) {
    res.status(400).json({
      error: 'Enter at least one valid ticker. Example: AAPL, MSFT, NVDA',
    })
    return
  }

  const results = await settleSymbolsWithConcurrency(symbols)

  const data = results
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value)
  const failed = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason?.message)

  res.json({
    data,
    failed,
  })
})

app.post('/api/newsletter/subscribe', async (req, res) => {
  try {
    const email = String(req.body?.email ?? '')
    const result = await subscribeToNewsletter(email)
    if (!result.ok) {
      res.status(400).json(result)
      return
    }
    res.json(result)
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message ?? 'Could not subscribe.' })
  }
})

app.post('/api/newsletter/unsubscribe', async (req, res) => {
  try {
    const token = String(req.body?.token ?? req.query.token ?? '')
    const result = await unsubscribeFromNewsletter(token)
    if (!result.ok) {
      res.status(400).json(result)
      return
    }
    res.json(result)
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message ?? 'Could not unsubscribe.' })
  }
})

// Triggered weekly by an external cron (GitHub Actions scheduled workflow). Protected by a
// shared secret since it fans out real emails via Resend.
app.post('/api/newsletter/send-weekly', async (req, res) => {
  const secret = process.env.NEWSLETTER_CRON_SECRET?.trim()
  const provided = req.get('x-cron-secret') ?? req.query.secret
  if (!secret || provided !== secret) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  try {
    const result = await sendWeeklyDigest()
    res.json({ ok: true, ...result })
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message ?? 'Could not send weekly digest.' })
  }
})

app.get('/api/screener/status', async (_req, res) => {
  if (!isDatabaseEnabled()) {
    res.json({ enabled: false })
    return
  }

  try {
    const status = await getSyncStatus(isSyncRunning())
    res.json({
      ...status,
      progress: isSyncRunning() ? getSyncProgress() : null,
    })
  } catch (error) {
    res.json({
      enabled: false,
      error: error?.message ?? 'Could not connect to PostgreSQL.',
    })
  }
})

app.get('/api/screener', async (req, res) => {
  if (!isDatabaseEnabled()) {
    res.status(503).json({
      error: 'DATABASE_URL is not configured. Set it to enable paginated screener.',
    })
    return
  }

  try {
    const result = await queryScreener({
      offset: req.query.offset,
      limit: req.query.limit,
      sort: req.query.sort,
      dir: req.query.dir,
      search: req.query.search,
      trend: req.query.trend,
      country: req.query.country,
    })
    res.json(result)
  } catch (error) {
    res.status(500).json({
      error: error?.message ?? 'Could not query screener.',
    })
  }
})

app.post('/api/screener/sync', async (req, res) => {
  if (!isDatabaseEnabled()) {
    res.status(503).json({
      error: 'DATABASE_URL is not configured.',
    })
    return
  }

  const force = req.query.force === '1' || req.query.force === 'true'

  if (isSyncRunning()) {
    res.json({ ok: true, syncing: true, progress: getSyncProgress() })
    return
  }

  void syncMarketData(
    {
      fetchMarketUniverse,
      fetchSymbolData,
    },
    { force }
  ).catch((error) => {
    console.warn('Market sync failed:', error?.message ?? error)
  })

  res.json({ ok: true, syncing: true })
})

app.get('/api/universe', async (req, res) => {
  try {
    const force = req.query.force === '1' || req.query.force === 'true'
    const data = await fetchMarketUniverse({ force })
    res.json({
      total: data.length,
      cached: !force,
      data,
    })
  } catch (error) {
    res.status(500).json({
      error:
        error?.message ??
        'Could not load stock universe at the moment.',
    })
  }
})

app.get('/api/market-snapshot/latest', (req, res) => {
  const cached = getMarketSnapshotIfFresh()
  if (cached) {
    res.json({
      cache: 'hit',
      savedAt: cached.savedAt,
      ageMs: Date.now() - cached.savedAt,
      total: cached.data.length,
      failed: cached.failed?.length ?? 0,
      data: cached.data,
    })
    return
  }

  res.json({
    cache: 'miss',
    building: Boolean(marketSnapshotBuildPromise),
  })
})

app.get('/api/market-snapshot', async (req, res) => {
  try {
    const force = req.query.force === '1' || req.query.force === 'true'
    const cached = !force && getMarketSnapshotIfFresh()

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    let closed = false
    req.on('close', () => { closed = true })

    if (cached) {
      if (!closed) {
        res.write(`data: ${JSON.stringify({
          type: 'progress',
          completed: 1,
          total: 1,
          batchData: cached.data,
          symbolsLoaded: cached.data.length,
          symbolsTotal: cached.data.length,
          cache: 'hit',
        })}\n\n`)
        res.write(`data: ${JSON.stringify({
          type: 'done',
          total: cached.data.length,
          failed: cached.failed?.length ?? 0,
          cache: 'hit',
        })}\n\n`)
        res.end()
      }
      return
    }

    const universe = await fetchMarketUniverse({ force })
    const symbols = universe.map((item) => item.symbol)
    const totalBatches = Math.ceil(symbols.length / SNAPSHOT_BATCH_SIZE)

    if (!closed) {
      res.write(`data: ${JSON.stringify({
        type: 'started',
        total: totalBatches,
        symbolsTotal: symbols.length,
      })}\n\n`)
    }

    let startedSent = true
    let streamedAny = false

    const snapshot = await getOrBuildMarketSnapshot({
      force,
      onBatchComplete: (progress) => {
        if (closed) {
          return
        }

        if (!startedSent) {
          startedSent = true
          res.write(`data: ${JSON.stringify({
            type: 'started',
            total: progress.total,
            symbolsTotal: progress.symbolsTotal,
          })}\n\n`)
        }

        if (progress.batchData?.length) {
          streamedAny = true
          res.write(`data: ${JSON.stringify({
            type: 'progress',
            completed: progress.completed,
            total: progress.total,
            batchData: progress.batchData,
            symbolsLoaded: progress.symbolsLoaded,
            symbolsTotal: progress.symbolsTotal,
            cache: 'miss',
          })}\n\n`)
        }
      },
    })

    if (!closed && !streamedAny && snapshot.data?.length) {
      res.write(`data: ${JSON.stringify({
        type: 'progress',
        completed: 1,
        total: 1,
        batchData: snapshot.data,
        symbolsLoaded: snapshot.data.length,
        symbolsTotal: snapshot.data.length,
        cache: 'hit',
      })}\n\n`)
    }

    if (!closed) {
      res.write(`data: ${JSON.stringify({
        type: 'done',
        total: snapshot.data.length,
        failed: snapshot.failed?.length ?? 0,
        cache: 'miss',
      })}\n\n`)
      res.end()
    }
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({
        error: error?.message ?? 'Could not generate market snapshot.',
      })
    }
  }
})

app.get('/api/fmp/fundamentals', async (req, res) => {
  if (!FMP_API_KEY) {
    res.status(503).json({
      error:
        'Financial Modeling Prep is not configured. Set FMP_API_KEY in the server environment.',
    })
    return
  }

  const symbols = parseSymbols(req.query.symbol ?? '')
  const symbol = symbols[0]

  if (!symbol) {
    res.status(400).json({
      error: 'Provide a valid symbol query parameter, e.g. ?symbol=AAPL',
    })
    return
  }

  const cached = fmpFundamentalsCache.get(symbol)
  if (cached && Date.now() - cached.savedAt < FMP_FUNDAMENTALS_CACHE_TTL_MS) {
    res.json({ cache: 'hit', ...cached.value })
    return
  }

  try {
    const data = await fetchFundamentalsBundle(symbol)
    fmpFundamentalsCache.set(symbol, { value: data, savedAt: Date.now() })
    saveMapCacheToDisk(FMP_FUNDAMENTALS_CACHE_FILE, fmpFundamentalsCache)
    res.json({ cache: 'miss', ...data })
  } catch (error) {
    res.status(500).json({
      error: error?.message ?? 'Could not load FMP fundamentals.',
    })
  }
})

app.get('/api/technical-analysis', async (req, res) => {
  const symbols = parseSymbols(req.query.symbol ?? '')
  const symbol = symbols[0]

  if (!symbol) {
    res.status(400).json({
      error: 'Provide a valid symbol query parameter, e.g. ?symbol=AAPL',
    })
    return
  }

  const cached = technicalAnalysisCache.get(symbol)
  if (cached && Date.now() - cached.savedAt < TECHNICAL_ANALYSIS_CACHE_TTL_MS) {
    res.json({ cache: 'hit', ...cached.value })
    return
  }

  try {
    const { candles, dataSource, fmpError } = await fetchOhlcv(symbol, {
      lookbackDays: 260,
    })
    const { candles: cleanCandles, droppedInvalidBars } = sanitizeOhlcvCandles(candles)
    if (cleanCandles.length < 30) {
      res.status(502).json({
        error: `Not enough valid OHLCV data for ${symbol} after filtering bad bars.`,
      })
      return
    }
    const snapshot = computeTechnicalSnapshot(symbol, cleanCandles)

    let chartImageBase64 = null
    let chartImageError = null
    try {
      chartImageBase64 = await generateCandleChartPng(symbol, cleanCandles, {
        supports: snapshot.supports,
        resistances: snapshot.resistances,
      })
    } catch (error) {
      chartImageError = error?.message ?? 'Chart image generation failed.'
    }

    const provider = resolveActiveAiProvider()
    let analysis = null
    let analysisError = null
    let aiMeta = null

    if (provider) {
      try {
        const prompt = buildTechnicalAnalysisPrompt(snapshot, {
          withImage: Boolean(chartImageBase64),
        })
        const {
          rawText,
          model,
          provider: usedProvider,
          imageUsed,
        } = await callAiAnalysis(prompt, { imageBase64: chartImageBase64 })
        const parsed = parseAiAnalysisJson(rawText)
        if (!parsed) {
          analysisError = 'AI returned a response that could not be parsed as JSON.'
        } else {
          analysis = parsed
          aiMeta = { provider: usedProvider, model, imageUsed: Boolean(imageUsed) }
        }
      } catch (error) {
        analysisError = error?.message ?? 'AI analysis failed.'
      }
    } else {
      analysisError = hasAnyAiKey()
        ? 'No AI provider active. Check AI_PROVIDER env value.'
        : 'AI analysis disabled. Set GEMINI_API_KEY, GROQ_API_KEY, or ANTHROPIC_API_KEY on the server (Render env vars).'
    }

    const responsePayload = {
      symbol: snapshot.symbol,
      asOf: snapshot.asOf,
      currentPrice: snapshot.currentPrice,
      indicators: snapshot.indicators,
      supports: snapshot.supports,
      resistances: snapshot.resistances,
      recentCandles: snapshot.recentCandles,
      dataSource,
      fmpFallbackReason: dataSource !== 'fmp' && fmpError ? fmpError : null,
      droppedInvalidBars: droppedInvalidBars > 0 ? droppedInvalidBars : null,
      dataQualityNote:
        droppedInvalidBars > 0
          ? `Filtered ${droppedInvalidBars} OHLCV bar(s) with zero/invalid prices from the data source.`
          : null,
      analysis,
      analysisError,
      ai: aiMeta,
      chartImageError,
      disclaimer:
        'Análisis técnico descriptivo e híbrido (datos OHLCV + gráfico renderizado). NO constituye consejo de inversión.',
    }

    // Only cache when the AI narrative succeeded — otherwise the next click should retry.
    // Indicators/levels alone (without analysis) are cheap to recompute, so this is a worthwhile trade-off.
    const aiSucceeded = analysis !== null
    if (aiSucceeded) {
      technicalAnalysisCache.set(symbol, { value: responsePayload, savedAt: Date.now() })
      saveMapCacheToDisk(TECHNICAL_ANALYSIS_CACHE_FILE, technicalAnalysisCache)
    }
    res.json({ cache: aiSucceeded ? 'miss' : 'no-cache', ...responsePayload })
  } catch (error) {
    res.status(500).json({
      error: error?.message ?? 'Could not load technical analysis.',
    })
  }
})

app.get('/api/company-profiles', async (req, res) => {
  const symbols = parseSymbols(req.query.symbols)

  if (!symbols.length) {
    res.status(400).json({
      error: 'Enter at least one valid ticker. Example: AAPL, MSFT, NVDA',
    })
    return
  }

  let companyNameBySymbol = new Map()
  try {
    const universe = await fetchMarketUniverse()
    companyNameBySymbol = new Map(universe.map((item) => [item.symbol, item.name]))
  } catch {
    companyNameBySymbol = new Map()
  }

  const results = await settleProfilesWithConcurrency(symbols, companyNameBySymbol)
  const data = results
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value)
  const failed = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason?.message)

  res.json({
    data,
    failed,
  })
})

const server = http.createServer(app)

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.log(
      `Port ${PORT} is already in use. Reusing existing backend process on that port.`
    )
    process.exit(0)
  }

  throw error
})

server.listen(PORT, async () => {
  console.log(`Stock API server running on http://localhost:${PORT}`)

  await loadMapCacheFromDisk(FMP_FUNDAMENTALS_CACHE_FILE, fmpFundamentalsCache, FMP_FUNDAMENTALS_CACHE_TTL_MS)
  await loadMapCacheFromDisk(TECHNICAL_ANALYSIS_CACHE_FILE, technicalAnalysisCache, TECHNICAL_ANALYSIS_CACHE_TTL_MS)

  if (isDatabaseEnabled()) {
    const retryDelaysMs = [0, 2_000, 5_000, 10_000]
    for (const [attempt, delayMs] of retryDelaysMs.entries()) {
      if (delayMs) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
      try {
        await initSchema()
        console.log('PostgreSQL schema ready.')
        scheduleMarketSync({
          fetchMarketUniverse,
          fetchSymbolData,
        })
        return
      } catch (error) {
        const lastAttempt = attempt === retryDelaysMs.length - 1
        console.warn(
          `PostgreSQL init failed (attempt ${attempt + 1}/${retryDelaysMs.length}):`,
          error?.message ?? error
        )
        if (lastAttempt) {
          console.warn('Screener will stay off until PostgreSQL is reachable and the API restarts.')
        }
      }
    }
    return
  }

  await loadMarketSnapshotFromDisk()
  scheduleMarketSnapshotWarmup()
})

server.on('close', () => {
  console.log('Stock API server closed.')
})
