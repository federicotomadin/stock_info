import { sendResendEmail, isMailConfigured } from '../lib/mail.js'
import { toTickerSymbol, type AccountSnapshot } from '../broker/ibkr.js'
import { AGENT_CONFIG } from './config.js'
import { getSessionDay, listFillsForDay, markReportSent, type StoredFill } from './session.js'
import { nyCalendarDate } from './marketHours.js'
import { sessionPnl } from './dayPlan.js'

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

export function buildDailyReportHtml(input: {
  day: string
  pnl: number | null
  openNl: number | null
  closeNl: number | null
  buys: ReturnType<typeof aggregate>
  sells: ReturnType<typeof aggregate>
}): string {
  const tone = (input.pnl ?? 0) >= 0 ? '#0f7b4c' : '#b42318'
  return `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;">
      <h2>Resumen paper IBKR · ${input.day}</h2>
      <p style="font-size:22px;font-weight:700;color:${tone};margin:8px 0 16px;">
        P&L de la sesión: ${usd(input.pnl)}
      </p>
      <p style="color:#444;">Equity al abrir ${usd(input.openNl)} → al cierre ${usd(input.closeNl)}. El P&L es la diferencia de Net Liquidation (caja + posiciones), no un retiro de cash.</p>
      <h3>Compras</h3>
      ${rowsHtml(input.buys, 'No hubo compras ejecutadas.')}
      <h3>Ventas (stops / take-profit / salidas)</h3>
      ${rowsHtml(input.sells, 'No hubo ventas ejecutadas.')}
      <p style="margin-top:24px;font-size:12px;color:#666;">
        Informe automático de la cuenta paper. No es asesoramiento financiero. Meta diaria +${usd(AGENT_CONFIG.dailyProfitUsd)} /
        stop diario −${usd(AGENT_CONFIG.dailyLossUsd)}: al tocarlos el agente deja de abrir trades, no cierra las posiciones a mercado.
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

  const session = await getSessionDay(day)
  if (session?.reportSentAt && !opts.force) {
    return { sent: false, reason: `El reporte del ${day} ya se envió.` }
  }

  const fills = await listFillsForDay(day)
  const liveClose = day === nyCalendarDate() ? snapshot?.netLiquidation ?? null : null
  const closeNl = session?.closeNl ?? liveClose
  const openNl = session?.openNl ?? null
  const html = buildDailyReportHtml({
    day,
    pnl: sessionPnl(openNl, closeNl),
    openNl,
    closeNl,
    buys: aggregate(fills, 'BUY'),
    sells: aggregate(fills, 'SELL'),
  })
  const pnl = sessionPnl(openNl, closeNl)
  const pnlLabel = pnl == null ? 'sin P&L' : `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USD`
  await sendResendEmail({
    to,
    subject: `Paper IBKR · ${day} · ${pnlLabel}`,
    html,
  })
  await markReportSent(day)
  return { sent: true, reason: `Mail enviado a ${to} (${day}).` }
}
