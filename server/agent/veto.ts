import { callAiAnalysis, hasAnyAiKey } from '../ai.js'
import { parseAiAnalysisJson } from '../lib/utils.js'
import type { BracketProposal } from '../broker/proposal.js'
import { AGENT_CONFIG } from './config.js'

export async function vetoEntry(
  proposal: BracketProposal,
  extra: { name?: string; trendLabel: string }
): Promise<{ approved: boolean; reason: string }> {
  if (!AGENT_CONFIG.aiVeto || !hasAnyAiKey()) {
    return { approved: true, reason: 'Sin veto de IA (reglas solamente).' }
  }

  try {
    const prompt = [
      'You are a risk officer for a long-only US stock paper account.',
      'Approve or reject this proposed buy. Do not suggest prices, size, or alternative tickers.',
      'Reply with JSON only: {"action":"approve"|"reject","reason":"one short sentence"}',
      `Symbol: ${proposal.symbol}`,
      extra.name ? `Name: ${extra.name}` : '',
      `Trend: ${extra.trendLabel}`,
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
