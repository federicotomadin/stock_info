import { sendResendEmail, isMailConfigured } from '../lib/mail.js'
import { BROKER_PROVIDER } from '../broker/config.js'
import { toTickerSymbol } from '../broker/symbols.js'
import type { AccountSnapshot } from '../broker/types.js'
import { AGENT_CONFIG } from './config.js'
import {
  clearDailyReportClaim,
  clearWeeklyReportClaim,
  getSessionDay,
  listFillsForDay,
  listSessionDaysBetween,
  markReportSent,
  tryClaimDailyReport,
  tryClaimWeeklyReport,
  type StoredFill,
} from './session.js'
import { nyCalendarDate, previousCompletedWeekRange } from './marketHours.js'
import { evaluateWeekHalt, sessionPnl } from './dayPlan.js'
import { resolveGoalLimits } from './goals.js'
import { listOpenTrades } from './journal.js'

const usd = (value: number | null | undefined): string =>
  Number.isFinite(value)
    ? `US$${value!.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—'

function aggregate(fills: StoredFill[], side: StoredFill['side']): Array<{ symbol: string; quantity: number; notional: number; avg: number }> {
  const bySymbol = new Map<string, { quantity: number; notional: number }>()
  for (const fill of fills.filter((item) => item.side === side)) {
    const symbol = toTickerSymbol(fill.symbol)
    const current = bySymbol.get(symbol) ?? { quantity: 0, notional: 0 }
    current.quantity += fill.quantity
    current.notional += fill.quantity * fill.price
    bySymbol.set(symbol, current)
  }
  return [...bySymbol.entries()].map(([symbol, value]) => ({
    symbol,
    quantity: value.quantity,
    notional: value.notional,
    avg: value.quantity ? value.notional / value.quantity : 0,
  }))
}

function rowsHtml(items: Array<{ symbol: string; quantity: number; avg: number; notional: number }>, empty: string): string {
  if (!items.length) {
    return `<p style="color:#666;">${empty}</p>`
  }
  return `
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <thead>
        <tr>
          <th style="text-align:left;padding:8px 12px;">Ticker</th>
          <th style="text-align:right;padding:8px 12px;">Acciones</th>
          <th style="text-align:right;padding:8px 12px;">Precio medio</th>
          <th style="text-align:right;padding:8px 12px;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${items
          .map(
            (item) => `
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;"><strong>${item.symbol}</strong></td>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">${item.quantity}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">${usd(item.avg)}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">${usd(item.notional)}</td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>`
}

function brokerLabel(): string {
  return BROKER_PROVIDER === 'alpaca' ? 'Alpaca paper' : 'IBKR paper'
}

export function buildDailyReportHtml(input: {
  day: string
  pnl: number | null
  openNl: number | null
  closeNl: number | null
  buys: ReturnType<typeof aggregate>
  sells: ReturnType<typeof aggregate>
  goalProfitUsd: number
  goalLossUsd: number
  goalProfitPct?: number | null
  goalLossPct?: number | null
}): string {
  const metaDaily =
    input.goalProfitPct != null
      ? `Meta diaria +${input.goalProfitPct}% equity (${usd(input.goalProfitUsd)}) / stop −${input.goalLossPct ?? '—'}% (${usd(input.goalLossUsd)})`
      : `Meta diaria +${usd(input.goalProfitUsd)} / stop diario −${usd(input.goalLossUsd)}`
  const tone = (input.pnl ?? 0) >= 0 ? '#0f7b4c' : '#b42318'
  return `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;">
      <h2>Resumen ${brokerLabel()} · ${input.day}</h2>
      <p style="font-size:22px;font-weight:700;color:${tone};margin:8px 0 16px;">
        P&L de la sesión: ${usd(input.pnl)}
      </p>
      <p style="color:#444;">Equity al abrir ${usd(input.openNl)} → al cierre ${usd(input.closeNl)}. El P&L es la diferencia de Net Liquidation (caja + posiciones), no un retiro de cash.</p>
      <h3>Compras</h3>
      ${rowsHtml(input.buys, 'No hubo compras ejecutadas.')}
      <h3>Ventas (stops / take-profit / salidas)</h3>
      ${rowsHtml(input.sells, 'No hubo ventas ejecutadas.')}
      <p style="margin-top:24px;font-size:12px;color:#666;">
        Informe automático de la cuenta paper. No es asesoramiento financiero. ${metaDaily}: al tocarlos el agente deja de abrir trades, no cierra las posiciones a mercado.
      </p>
    </div>`
}

export async function sendDailySessionReport(
  day: string,
  snapshot: AccountSnapshot | null,
  opts: { force?: boolean } = {}
): Promise<{ sent: boolean; reason: string }> {
  const to = AGENT_CONFIG.reportEmail
  if (!to) return { sent: false, reason: 'Falta AGENT_REPORT_EMAIL en el .env.' }
  if (!isMailConfigured()) return { sent: false, reason: 'Falta RESEND_API_KEY para enviar el mail.' }

  if (!opts.force) {
    const session = await getSessionDay(day)
    if (session?.reportSentAt) {
      return { sent: false, reason: `El reporte del ${day} ya se envió.` }
    }
    if (!(await tryClaimDailyReport(day))) {
      return { sent: false, reason: `El reporte del ${day} ya se envió.` }
    }
  }

  const session = await getSessionDay(day)
  const fills = await listFillsForDay(day)
  const liveClose = day === nyCalendarDate() ? snapshot?.netLiquidation ?? null : null
  const closeNl = session?.closeNl ?? liveClose
  const openNl = session?.openNl ?? null
  const goals = resolveGoalLimits(closeNl ?? openNl ?? snapshot?.netLiquidation ?? null)
  const html = buildDailyReportHtml({
    day,
    pnl: sessionPnl(openNl, closeNl),
    openNl,
    closeNl,
    buys: aggregate(fills, 'BUY'),
    sells: aggregate(fills, 'SELL'),
    goalProfitUsd: goals.dailyProfitUsd,
    goalLossUsd: goals.dailyLossUsd,
    goalProfitPct: AGENT_CONFIG.dailyProfitPct,
    goalLossPct: AGENT_CONFIG.dailyLossPct,
  })
  const pnl = sessionPnl(openNl, closeNl)
  const pnlLabel = pnl == null ? 'sin P&L' : `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USD`
  try {
    await sendResendEmail({
      to,
      subject: `Paper · ${day} · ${pnlLabel}`,
      html,
    })
  } catch (error) {
    if (!opts.force) await clearDailyReportClaim(day)
    throw error
  }
  if (opts.force) await markReportSent(day)
  return { sent: true, reason: `Mail enviado a ${to} (${day}).` }
}

function goalStatusHtml(weekPnl: number, goals: ReturnType<typeof resolveGoalLimits>): string {
  const halt = evaluateWeekHalt(weekPnl, goals.weeklyProfitUsd, goals.weeklyLossUsd)
  const meta =
    AGENT_CONFIG.weeklyProfitPct != null
      ? `+${AGENT_CONFIG.weeklyProfitPct}% (${usd(goals.weeklyProfitUsd)})`
      : `+${usd(goals.weeklyProfitUsd)}`
  if (halt.halt && halt.reason === 'profit') {
    return `<p style="color:#0f7b4c;font-weight:600;">Meta semanal alcanzada (${meta}).</p>`
  }
  if (halt.halt && halt.reason === 'loss') {
    const stop =
      AGENT_CONFIG.weeklyLossPct != null
        ? `−${AGENT_CONFIG.weeklyLossPct}% (${usd(goals.weeklyLossUsd)})`
        : `−${usd(goals.weeklyLossUsd)}`
    return `<p style="color:#b42318;font-weight:600;">Stop semanal tocado (${stop}).</p>`
  }
  const gap = goals.weeklyProfitUsd - weekPnl
  if (gap > 0 && goals.weeklyProfitUsd > 0) {
    return `<p style="color:#444;">Meta no alcanzada: faltaron ${usd(gap)} para llegar a ${meta} (${Math.round((weekPnl / goals.weeklyProfitUsd) * 100)}% del objetivo en USD).</p>`
  }
  return `<p style="color:#0f7b4c;">Semana cerrada por encima de la meta configurada.</p>`
}

export function buildWeeklyReportHtml(input: {
  weekStart: string
  weekEnd: string
  weekPnl: number
  days: Array<{ day: string; pnl: number | null }>
  openTrades: number
  goals: ReturnType<typeof resolveGoalLimits>
}): string {
  const tone = input.weekPnl >= 0 ? '#0f7b4c' : '#b42318'
  const dayRows = input.days
    .map((row) => {
      const pnl = row.pnl
      const color = (pnl ?? 0) >= 0 ? '#0f7b4c' : '#b42318'
      const label = pnl == null ? '—' : `${pnl >= 0 ? '+' : ''}${usd(pnl)}`
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${row.day}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;color:${color};">${label}</td>
      </tr>`
    })
    .join('')

  const guardrails = [
    AGENT_CONFIG.aiVeto ? 'veto IA' : null,
    AGENT_CONFIG.newsVeto ? 'noticias' : null,
    AGENT_CONFIG.buffettFundamentals ? 'fundamentales Buffett' : null,
    AGENT_CONFIG.buffettHardRules ? 'reglas duras ROE/deuda' : null,
    AGENT_CONFIG.mrMarketDiscipline ? 'Mr. Market en ranking' : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;">
      <h2>Agente · semana ${input.weekStart} → ${input.weekEnd}</h2>
      <p style="font-size:22px;font-weight:700;color:${tone};margin:8px 0 12px;">
        P&L semanal (NY): ${input.weekPnl >= 0 ? '+' : ''}${usd(input.weekPnl)}
      </p>
      <p style="color:#444;margin:0 0 8px;">
        Meta ${
          AGENT_CONFIG.weeklyProfitPct != null
            ? `+${AGENT_CONFIG.weeklyProfitPct}% (${usd(input.goals.weeklyProfitUsd)})`
            : `+${usd(input.goals.weeklyProfitUsd)}`
        } · Stop ${
          AGENT_CONFIG.weeklyLossPct != null
            ? `−${AGENT_CONFIG.weeklyLossPct}% (${usd(input.goals.weeklyLossUsd)})`
            : `−${usd(input.goals.weeklyLossUsd)}`
        }${
          input.goals.equityBase != null
            ? ` · base equity ${usd(input.goals.equityBase)}`
            : ''
        }
      </p>
      ${goalStatusHtml(input.weekPnl, input.goals)}
      <h3>P&L por sesión</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr>
            <th style="text-align:left;padding:6px 10px;">Día (NY)</th>
            <th style="text-align:right;padding:6px 10px;">P&L</th>
          </tr>
        </thead>
        <tbody>${dayRows || '<tr><td colspan="2" style="padding:8px;color:#666;">Sin datos de sesión esta semana.</td></tr>'}</tbody>
      </table>
      <p style="margin-top:16px;color:#444;">Trades abiertos del agente ahora: <strong>${input.openTrades}</strong></p>
      <p style="margin-top:20px;font-size:12px;color:#666;">
        Broker: ${brokerLabel()}. Guardrails: ${guardrails || '—'}.
        No es asesoramiento financiero.
      </p>
    </div>`
}

/** Resumen semanal (semana NY cerrada). Por defecto la semana anterior al día actual. */
export async function sendWeeklyAgentReport(
  opts: { force?: boolean; weekStart?: string; weekEnd?: string } = {}
): Promise<{ sent: boolean; reason: string; weekStart?: string; weekEnd?: string; weekPnl?: number }> {
  const to = AGENT_CONFIG.reportEmail
  if (!to) return { sent: false, reason: 'Falta AGENT_REPORT_EMAIL en el .env.' }
  if (!isMailConfigured()) return { sent: false, reason: 'Falta RESEND_API_KEY para enviar el mail.' }

  const range = opts.weekStart && opts.weekEnd
    ? { weekStart: opts.weekStart, weekEnd: opts.weekEnd }
    : previousCompletedWeekRange()

  if (!opts.force && !(await tryClaimWeeklyReport(range.weekStart))) {
    return {
      sent: false,
      reason: `El reporte de la semana ${range.weekStart} ya se envió.`,
      weekStart: range.weekStart,
      weekEnd: range.weekEnd,
    }
  }

  const sessions = await listSessionDaysBetween(range.weekStart, range.weekEnd)
  const days = sessions.map((row) => ({
    day: row.day,
    pnl: sessionPnl(row.openNl, row.closeNl),
  }))
  let weekPnl = 0
  for (const row of days) {
    if (row.pnl != null) weekPnl += row.pnl
  }
  weekPnl = Number(weekPnl.toFixed(2))

  const lastClose = sessions.at(-1)?.closeNl ?? null
  const goals = resolveGoalLimits(lastClose ?? AGENT_CONFIG.goalEquityUsd)
  const openTrades = (await listOpenTrades()).length
  const html = buildWeeklyReportHtml({
    weekStart: range.weekStart,
    weekEnd: range.weekEnd,
    weekPnl,
    days,
    openTrades,
    goals,
  })
  const pnlLabel = `${weekPnl >= 0 ? '+' : ''}${weekPnl.toFixed(2)} USD`

  try {
    await sendResendEmail({
      to,
      subject: `Agente · semana ${range.weekStart} · ${pnlLabel} · meta ${usd(goals.weeklyProfitUsd)}`,
      html,
    })
  } catch (error) {
    if (!opts.force) await clearWeeklyReportClaim(range.weekStart)
    throw error
  }

  return {
    sent: true,
    reason: `Mail semanal enviado a ${to} (${range.weekStart} → ${range.weekEnd}).`,
    weekStart: range.weekStart,
    weekEnd: range.weekEnd,
    weekPnl,
  }
}
