import { fetchSymbolData } from '../marketData.js'
import { fetchWithTimeout } from '../lib/http.js'

const YAHOO_RSS = (ticker: string) =>
  `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker)}&region=US&lang=en-US`

function decodeXmlText(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

interface RssItem {
  title: string
  pubDate: Date | null
  link: string
}

function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = []
  const blocks = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)
  for (const block of blocks) {
    const chunk = block[1] ?? ''
    const titleM = chunk.match(/<title>([\s\S]*?)<\/title>/i)
    const dateM = chunk.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)
    const linkM = chunk.match(/<link>([\s\S]*?)<\/link>/i)
    if (!titleM) continue
    const title = decodeXmlText(titleM[1]!)
    let pubDate: Date | null = null
    if (dateM) {
      const parsed = new Date(dateM[1]!.trim())
      pubDate = Number.isNaN(parsed.getTime()) ? null : parsed
    }
    items.push({
      title,
      pubDate,
      link: linkM ? decodeXmlText(linkM[1]!) : '',
    })
  }
  return items
}

function formatEt(d: Date): string {
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export async function fetchYahooHeadlinesBrief(symbol: string, hours = 12): Promise<string | null> {
  const ticker = symbol.toUpperCase().replace(/\s+/g, '.')
  const cutoff = Date.now() - hours * 3600 * 1000
  const lines: string[] = []

  try {
    const response = await fetchWithTimeout(
      YAHOO_RSS(ticker),
      { headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*' } },
      20_000
    )
    if (!response.ok) {
      lines.push(`note: Yahoo RSS HTTP ${response.status} for ${ticker}`)
    } else {
      const xml = await response.text()
      const items = parseRssItems(xml).filter((it) => !it.pubDate || it.pubDate.getTime() >= cutoff)
      if (!items.length) {
        lines.push(`No headlines in the last ${hours}h for ${ticker} (RSS may be empty).`)
      } else {
        for (const it of items.slice(0, 15)) {
          const when = it.pubDate ? `${formatEt(it.pubDate)} ET` : 'time unknown'
          lines.push(`${when}  ${it.title}`)
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'fetch failed'
    lines.push(`note: Yahoo RSS for ${ticker}: ${message}`)
  }

  try {
    const quote = await fetchSymbolData(ticker)
    const dayCh = quote.dayChange as number | null | undefined
    if (Number.isFinite(dayCh)) {
      lines.unshift(
        `${ticker} ${Number(quote.price).toFixed(2)} ${dayCh! >= 0 ? '+' : ''}${dayCh!.toFixed(2)}% today (Stooq/Yahoo/FMP)`
      )
    }
  } catch {
    /* optional move line */
  }

  const text = lines.join('\n').trim()
  return text || null
}