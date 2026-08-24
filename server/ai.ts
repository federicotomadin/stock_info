import {
  AI_PROVIDER,
  ANTHROPIC_API_KEY,
  CLAUDE_MODEL,
  GEMINI_API_KEY,
  GEMINI_MODEL,
  GROQ_API_KEY,
  GROQ_MODEL,
} from './config.js'
import { fetchWithTimeout } from './lib/http.js'
import { formatNumber } from './lib/utils.js'

export function buildTechnicalAnalysisPrompt(snapshot, { withImage = false } = {}) {
  const { indicators: i, supports, resistances, recentCandles } = snapshot
  const supportStr = supports.length
    ? supports.map((s) => `$${formatNumber(s.level)} (${s.touches} toques)`).join(', ')
    : 'ninguno claro'
  const resistanceStr = resistances.length
    ? resistances.map((r) => `$${formatNumber(r.level)} (${r.touches} toques)`).join(', ')
    : 'ninguna clara'

  const candlesTable = recentCandles
    .map(
      (c) =>
        `${c.date}: O=${formatNumber(c.open)} H=${formatNumber(c.high)} L=${formatNumber(c.low)} C=${formatNumber(c.close)} Vol=${c.volume}`
    )
    .join('\n')

  const imageNote = withImage
    ? `
ADEMÁS se adjunta una IMAGEN del gráfico de velas diario (últimas 90 barras) con SMA 20 y SMA 50 como líneas superpuestas y los soportes/resistencias dibujados como líneas punteadas. Usá la imagen como contexto visual: identificá patrones gráficos (HCH, doble techo/piso, banderas, triángulos, cruces de medias) y la forma global del precio. Combiná eso con la precisión numérica de los datos de abajo.`
    : ''

  return `Sos un analista técnico experto. Analizá los siguientes datos de ${snapshot.symbol} al ${snapshot.asOf}.${imageNote}

INDICADORES CALCULADOS:
- Precio actual: $${formatNumber(snapshot.currentPrice)}
- Cambio diario: ${formatNumber(i.dayChange)}%
- Cambio mensual: ${formatNumber(i.monthChange)}%
- SMA 20: $${formatNumber(i.sma20)}
- SMA 50: $${formatNumber(i.sma50)}
- SMA 200: $${formatNumber(i.sma200)}
- RSI 14: ${formatNumber(i.rsi14)}
- Volumen promedio 20d vs 60d: ${formatNumber(i.volumeTrendPct)}%
- Soportes detectados: ${supportStr}
- Resistencias detectadas: ${resistanceStr}

ÚLTIMAS 30 VELAS DIARIAS (OHLCV):
${candlesTable}

Devolvé ÚNICAMENTE un JSON válido (sin markdown, sin \`\`\`) con esta forma exacta:
{
  "trend": "uptrend" | "downtrend" | "sideways",
  "trendStrength": "weak" | "moderate" | "strong",
  "rsiReading": "oversold" | "neutral" | "overbought",
  "momentum": "bullish" | "bearish" | "neutral",
  "keyObservations": ["obs 1", "obs 2", "obs 3"],
  "patterns": ["patrón 1 si existe, ej: bandera alcista, doble techo, HCH, cruce dorado"],
  "narrative": "Párrafo en español (máx 4 oraciones) describiendo lo que muestra el gráfico. SOLO descripción técnica.",
  "riskFlags": ["factor de riesgo 1", "factor de riesgo 2"]
}

REGLAS CRÍTICAS:
1. Jamás incluyas consejo direccional ("comprar", "vender", "mantener", "es buena oportunidad"). Solo descripción técnica neutra.
2. Todo el texto ("keyObservations", "patterns", "narrative", "riskFlags") debe estar en español.
3. Si no hay patrón claro, "patterns" puede ser array vacío [].
4. No inventes niveles que no estén en los datos.
5. Respondé SOLO el JSON, sin texto extra.`
}

export async function callGeminiAnalysis(prompt, { imageBase64 = null } = {}) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured')
  }

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent` +
    `?key=${encodeURIComponent(GEMINI_API_KEY)}`

  const parts: Array<Record<string, unknown>> = [{ text: prompt }]
  if (imageBase64) {
    parts.push({
      inline_data: { mime_type: 'image/png', data: imageBase64 },
    })
  }

  const response = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      }),
    },
    45000
  )

  const text = await response.text()
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error(
        `Gemini quota agotada (HTTP 429). Free tier: 15 requests/min · 1500 requests/día. ` +
          `Esperá unos minutos y volvé a clickear, o cambiá AI_PROVIDER=groq en .env como alternativa free.`
      )
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Gemini auth error (HTTP ${response.status}). Verificá que GEMINI_API_KEY sea válida en aistudio.google.com/apikey.`
      )
    }
    throw new Error(`Gemini HTTP ${response.status}: ${text.slice(0, 200)}`)
  }

  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('Gemini returned non-JSON body')
  }

  const rawText = payload?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  if (!rawText.trim()) {
    throw new Error('Gemini returned empty content')
  }

  return { rawText, model: GEMINI_MODEL, provider: 'gemini', imageUsed: Boolean(imageBase64) }
}

export async function callClaudeAnalysis(prompt, { imageBase64 = null } = {}) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured')
  }

  const content = []
  if (imageBase64) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: imageBase64 },
    })
  }
  content.push({ type: 'text', text: prompt })

  const response = await fetchWithTimeout(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        temperature: 0.2,
        messages: [{ role: 'user', content }],
      }),
    },
    45000
  )

  const text = await response.text()
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error(
        `Claude rate limit (HTTP 429). Esperá un momento y reintentá, o cambiá a Gemini/Groq mientras tanto.`
      )
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Claude auth error (HTTP ${response.status}). Verificá tu ANTHROPIC_API_KEY.`
      )
    }
    throw new Error(`Claude HTTP ${response.status}: ${text.slice(0, 200)}`)
  }

  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('Claude returned non-JSON body')
  }

  const rawText = payload?.content?.[0]?.text ?? ''
  if (!rawText.trim()) {
    throw new Error('Claude returned empty content')
  }

  return { rawText, model: CLAUDE_MODEL, provider: 'claude', imageUsed: Boolean(imageBase64) }
}

export async function callGroqAnalysis(prompt, { imageBase64 = null } = {}) {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not configured')
  }

  // Llama 3.3 70B (default) is text-only; drop the image silently rather than fail.
  // If user swaps GROQ_MODEL to a vision model (e.g. llama-4-scout), pass the image.
  const modelIsVision = /vision|scout|maverick|mm/.test(GROQ_MODEL.toLowerCase())
  const content = modelIsVision && imageBase64
    ? [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
      ]
    : prompt

  const response = await fetchWithTimeout(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content }],
      }),
    },
    45000
  )

  const text = await response.text()
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error(
        `Groq rate limit (HTTP 429). Free tier: ~30 req/min. Esperá un minuto y reintentá.`
      )
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Groq auth error (HTTP ${response.status}). Verificá tu GROQ_API_KEY en console.groq.com/keys.`
      )
    }
    throw new Error(`Groq HTTP ${response.status}: ${text.slice(0, 200)}`)
  }

  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('Groq returned non-JSON body')
  }

  const rawText = payload?.choices?.[0]?.message?.content ?? ''
  if (!rawText.trim()) {
    throw new Error('Groq returned empty content')
  }

  return {
    rawText,
    model: GROQ_MODEL,
    provider: 'groq',
    imageUsed: Boolean(imageBase64) && modelIsVision,
  }
}

export function hasAnyAiKey() {
  return Boolean(GEMINI_API_KEY || ANTHROPIC_API_KEY || GROQ_API_KEY)
}

export function resolveActiveAiProvider() {
  if (AI_PROVIDER === 'claude' && ANTHROPIC_API_KEY) return 'claude'
  if (AI_PROVIDER === 'groq' && GROQ_API_KEY) return 'groq'
  if (AI_PROVIDER === 'gemini' && GEMINI_API_KEY) return 'gemini'
  if (GEMINI_API_KEY) return 'gemini'
  if (GROQ_API_KEY) return 'groq'
  if (ANTHROPIC_API_KEY) return 'claude'
  return null
}

export async function callAiAnalysis(prompt, options = {}) {
  const provider = resolveActiveAiProvider()
  if (!provider) {
    throw new Error('No AI API key configured (set GEMINI_API_KEY, GROQ_API_KEY, or ANTHROPIC_API_KEY)')
  }

  if (provider === 'claude') return callClaudeAnalysis(prompt, options)
  if (provider === 'groq') return callGroqAnalysis(prompt, options)
  return callGeminiAnalysis(prompt, options)
}
