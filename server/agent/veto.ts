import { callAiAnalysis, hasAnyAiKey } from '../ai.js'
import { parseAiAnalysisJson } from '../lib/utils.js'
import type { BracketProposal } from '../broker/proposal.js'
import { fetchFundamentalsBundle } from '../fundamentals.js'
import { AGENT_CONFIG } from './config.js'
import {
  checkBlockedTicker,
  checkCircleOfCompetence,
  evaluateFundamentalsHard,
} from './buffettGuard.js'
import { extractFundamentalMetrics, formatFundamentalsBrief } from './fundamentalsBrief.js'
import { fetchTickerNewsBrief } from './traderNews.js'

export async function vetoEntry(
  proposal: BracketProposal,
  extra: { name?: string; trendLabel: string }
): Promise<{ approved: boolean; reason: string }> {
  const blocked = checkBlockedTicker(proposal.symbol, AGENT_CONFIG.blockedTickers)
  if (blocked.ok === false) {
    return { approved: false, reason: blocked.reason }
  }

  let fundamentalsText: string | null = null

  if (AGENT_CONFIG.buffettFundamentals) {
    try {
      const bundle = await fetchFundamentalsBundle(proposal.symbol)
      fundamentalsText = formatFundamentalsBrief(bundle)
      const { sector: sectorName } = extractFundamentalMetrics(bundle)

      const circle = checkCircleOfCompetence(
        sectorName,
        AGENT_CONFIG.allowedSectors,
        AGENT_CONFIG.blockedSectors
      )
      if (circle.ok === false) {
        return { approved: false, reason: circle.reason }
      }

      if (AGENT_CONFIG.buffettHardRules) {
        const hard = evaluateFundamentalsHard(bundle, {
          minRoePct: AGENT_CONFIG.buffettMinRoePct,
          maxDebtToEquity: AGENT_CONFIG.buffettMaxDebtToEquity,
          minNetMarginPct: AGENT_CONFIG.buffettMinNetMarginPct,
        })
        if (hard.ok === false) {
          return { approved: false, reason: hard.reason }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'fundamentales no disponibles'
      fundamentalsText = `Fundamentals fetch failed: ${message}`
    }
  }

  if (!AGENT_CONFIG.aiVeto || !hasAnyAiKey()) {
    const suffix = fundamentalsText ? ' Reglas Buffett OK.' : ''
    return { approved: true, reason: `Sin veto de IA (reglas solamente).${suffix}` }
  }

  try {
    const news =
      AGENT_CONFIG.newsVeto ? await fetchTickerNewsBrief(proposal.symbol) : null

    const prompt = [
      'You are a risk officer for a long-only US equity account applying Buffett-style guardrails on top of short-term technical entries.',
      'Reject speculative chase (extended momentum), poor owner economics (very low ROE, extreme leverage, deeply negative margins when data exists),',
      'or breaking news suggesting imminent earnings shock, legal risk, or a sharp adverse move.',
      'Approve only when business quality is acceptable for a tactical swing, not only because price is moving.',
      'Do not suggest prices, size, or alternative tickers.',
      'Reply with JSON only: {"action":"approve"|"reject","reason":"one short sentence in Spanish"}',
      `Symbol: ${proposal.symbol}`,
      extra.name ? `Name: ${extra.name}` : '',
      `Trend: ${extra.trendLabel}`,
      fundamentalsText ? `Fundamentals (FMP/Finnhub):\n${fundamentalsText}` : '',
      news ? `Recent headlines (unverified):\n${news}` : '',
      `Entry: ${proposal.entryPrice}`,
      `Stop: ${proposal.stopLoss} (${proposal.stopSource})`,
      `Take profit: ${proposal.takeProfit}`,
      `Shares: ${proposal.quantity}`,
      `Dollar risk if stopped: ${proposal.riskUsd}`,
    ]
      .filter(Boolean)
      .join('\n')

    const { rawText } = await callAiAnalysis(prompt)
    const parsed = parseAiAnalysisJson(rawText) as { action?: string; reason?: string } | null
    const action = parsed?.action === 'reject' ? 'reject' : parsed?.action === 'approve' ? 'approve' : null
    if (!action) {
      return { approved: true, reason: 'Veto de IA ilegible; se sigue con las reglas.' }
    }
    const reason = typeof parsed?.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim() : action
    return { approved: action === 'approve', reason }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'error de IA'
    return { approved: true, reason: `Veto de IA omitido (${message}).` }
  }
}