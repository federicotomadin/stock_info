import crypto from 'node:crypto'
import { getPool, isDatabaseEnabled } from './db/pool.js'
import { queryScreener } from './db/queries.js'

const RESEND_API_KEY = process.env.RESEND_API_KEY?.trim()
const NEWSLETTER_FROM_EMAIL = (process.env.NEWSLETTER_FROM_EMAIL || 'onboarding@resend.dev').trim()
const RESEND_API_URL = 'https://api.resend.com/emails'

export interface SubscribeResult {
  ok: boolean
  error?: string
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim())
}

export async function subscribeToNewsletter(rawEmail: string): Promise<SubscribeResult> {
  const email = rawEmail.trim().toLowerCase()
  if (!email || !isValidEmail(email)) {
    return { ok: false, error: 'Ingresá un email válido.' }
  }

  if (!isDatabaseEnabled()) {
    return { ok: false, error: 'El newsletter no está disponible en este momento (DB no configurada).' }
  }

  const pool = getPool()
  const token = crypto.randomUUID()

  await pool.query(
    `INSERT INTO newsletter_subscribers (email, unsubscribe_token)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET unsubscribed_at = NULL`,
    [email, token],
  )

  return { ok: true }
}

export async function unsubscribeFromNewsletter(token: string): Promise<SubscribeResult> {
  if (!isDatabaseEnabled()) {
    return { ok: false, error: 'DB no configurada.' }
  }
  if (!token?.trim()) {
    return { ok: false, error: 'Token inválido.' }
  }

  const pool = getPool()
  const result = await pool.query(
    `UPDATE newsletter_subscribers SET unsubscribed_at = NOW()
     WHERE unsubscribe_token = $1 AND unsubscribed_at IS NULL`,
    [token.trim()],
  )

  if (result.rowCount === 0) {
    return { ok: false, error: 'Token no encontrado o ya dado de baja.' }
  }
  return { ok: true }
}

async function getActiveSubscribers(): Promise<Array<{ email: string; unsubscribe_token: string }>> {
  const pool = getPool()
  const result = await pool.query(
    `SELECT email, unsubscribe_token FROM newsletter_subscribers WHERE unsubscribed_at IS NULL`,
  )
  return result.rows
}

async function getTop20(): Promise<Array<{ symbol: string; name: string; trendLabel: string; yearChange: number | null }>> {
  const { data } = await queryScreener({ limit: 20, sort: 'trend', dir: 'desc' })
  return data
    .filter((row) => row.trend.label !== 'Downtrend')
    .slice(0, 20)
    .map((row) => ({
      symbol: row.symbol,
      name: row.name,
      trendLabel: row.trend.label,
      yearChange: row.yearChange,
    }))
}

function buildEmailHtml(
  top20: Array<{ symbol: string; name: string; trendLabel: string; yearChange: number | null }>,
  unsubscribeUrl: string,
): string {
  const rows = top20
    .map(
      (stock, index) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${index + 1}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;"><strong>${stock.symbol}</strong> — ${stock.name}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${stock.trendLabel}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${
          stock.yearChange != null ? `${stock.yearChange.toFixed(1)}%` : 'N/A'
        }</td>
      </tr>`,
    )
    .join('')

  return `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;">
      <h2>Top 20 de la semana</h2>
      <p>Screener automático por señal de tendencia. No es asesoramiento financiero.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px 12px;">#</th>
            <th style="text-align:left;padding:8px 12px;">Ticker</th>
            <th style="text-align:left;padding:8px 12px;">Señal</th>
            <th style="text-align:left;padding:8px 12px;">1Y</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:24px;font-size:12px;color:#666;">
        Este informe es generado automáticamente a partir de datos de mercado públicos y no constituye
        asesoramiento financiero, recomendación de inversión ni oferta de compra/venta de valores.
        Invertí bajo tu propio criterio y consultá a un asesor matriculado antes de tomar decisiones.
      </p>
      <p style="font-size:12px;">
        <a href="${unsubscribeUrl}">Darme de baja</a>
      </p>
    </div>
  `
}

async function sendEmail(to: string, html: string): Promise<void> {
  if (!RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured')
  }

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: NEWSLETTER_FROM_EMAIL,
      to,
      subject: 'Top 20 de la semana — Stock Screener',
      html,
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Resend error ${response.status}: ${body}`)
  }
}

export interface SendWeeklyResult {
  sent: number
  failed: number
  top20: Array<{ symbol: string; name: string; trendLabel: string; yearChange: number | null }>
}

/** Sends the weekly Top-20 report to every active subscriber. Meant to be triggered by an
 * external cron (e.g. a scheduled GitHub Actions workflow hitting a protected endpoint). */
export async function sendWeeklyDigest(): Promise<SendWeeklyResult> {
  if (!isDatabaseEnabled()) {
    throw new Error('DATABASE_URL is not configured.')
  }

  const [subscribers, top20] = await Promise.all([getActiveSubscribers(), getTop20()])

  let sent = 0
  let failed = 0

  for (const subscriber of subscribers) {
    try {
      const unsubscribeUrl = `${process.env.SITE_ORIGIN || ''}?unsubscribe=${subscriber.unsubscribe_token}`
      const html = buildEmailHtml(top20, unsubscribeUrl)
      await sendEmail(subscriber.email, html)
      sent += 1
    } catch (error) {
      failed += 1
      console.error(`[newsletter] failed to send to ${subscriber.email}:`, error?.message ?? error)
    }
  }

  const pool = getPool()
  await pool.query(
    `INSERT INTO newsletter_sends (recipients_count, symbols) VALUES ($1, $2)`,
    [sent, top20.map((s) => s.symbol).join(',')],
  )

  return { sent, failed, top20 }
}
