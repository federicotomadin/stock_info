const RESEND_API_URL = 'https://api.resend.com/emails'

export function isMailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim())
}

export async function sendResendEmail(params: { to: string; subject: string; html: string }): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('Falta RESEND_API_KEY para enviar el mail.')
  }

  const from = (process.env.NEWSLETTER_FROM_EMAIL || 'onboarding@resend.dev').trim()
  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Resend error ${response.status}: ${body}`)
  }
}
