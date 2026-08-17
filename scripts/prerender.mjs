#!/usr/bin/env node
/**
 * Post-build SEO prerender for GitHub Pages (static hosting, no server templating).
 *
 * For every ticker in the universe, writes a physical `dist/stock/<SYMBOL>/index.html`
 * file — a clone of the built `dist/index.html` with per-ticker <title>, <meta description>,
 * canonical link and Open Graph/Twitter tags baked in. The bundled JS/CSS is untouched, so the
 * SPA still hydrates normally and fetches live data client-side; this step only makes each
 * ticker URL indexable with its own unique metadata (crawlers see real content once rendered,
 * but the <head> is correct even before JS runs).
 *
 * Also emits `dist/sitemap.xml` and `dist/robots.txt`.
 *
 * Env vars (all optional, with sane fallbacks matching the GitHub Pages workflow):
 *   API_ORIGIN / VITE_API_ORIGIN  Base URL of the deployed Express API (for /api/universe).
 *   SITE_ORIGIN                   Public origin of the site, e.g. https://user.github.io
 *   VITE_BASE_PATH                Base path Vite was built with, e.g. /stock_info/
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')

const API_ORIGIN = (
  process.env.API_ORIGIN ||
  process.env.VITE_API_ORIGIN ||
  'https://stock-info-api-ag2h.onrender.com'
).replace(/\/$/, '')

const BASE_PATH = ensureSlashes(process.env.VITE_BASE_PATH || '/')

const SITE_ORIGIN = (
  process.env.SITE_ORIGIN ||
  inferSiteOriginFromGithubActions() ||
  'https://example.github.io'
).replace(/\/$/, '')

function ensureSlashes(p) {
  let out = p.startsWith('/') ? p : `/${p}`
  if (!out.endsWith('/')) out += '/'
  return out
}

function inferSiteOriginFromGithubActions() {
  // GITHUB_REPOSITORY is "owner/repo" in Actions runners.
  const repo = process.env.GITHUB_REPOSITORY
  if (!repo) return null
  const [owner] = repo.split('/')
  return owner ? `https://${owner}.github.io` : null
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeXml(value) {
  return escapeHtml(value).replace(/'/g, '&apos;')
}

async function fetchUniverse() {
  const url = `${API_ORIGIN}/api/universe`
  console.log(`[prerender] fetching universe from ${url}`)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Universe fetch failed: HTTP ${response.status}`)
  }
  const body = await response.json()
  const data = Array.isArray(body?.data) ? body.data : []
  return data.filter((item) => item?.symbol && /^[A-Za-z0-9.\-]+$/.test(item.symbol))
}

function cleanCompanyName(name) {
  if (!name) return null
  return name
    .replace(/\s*-\s*Common Stock$/i, '')
    .replace(/\s*Common Stock$/i, '')
    .trim()
}

function buildTickerHtml(template, { symbol, name, exchange }) {
  const displayName = cleanCompanyName(name) || symbol
  const title = `${displayName} (${symbol}) Stock — Price, Fundamentals & Trend`
  const description = `${displayName} (${symbol}${exchange ? ` · ${exchange}` : ''}) stock: live chart, fundamentals, valuation ratios and AI-assisted technical analysis.`
  const canonicalUrl = `${SITE_ORIGIN}${BASE_PATH}stock/${symbol}`

  let html = template

  html = html.replace(/<title>.*?<\/title>/i, `<title>${escapeHtml(title)}</title>`)

  if (/<meta name="description"[^>]*>/i.test(html)) {
    html = html.replace(
      /<meta name="description"[^>]*>/i,
      `<meta name="description" content="${escapeHtml(description)}" />`,
    )
  } else {
    html = html.replace('</head>', `  <meta name="description" content="${escapeHtml(description)}" />\n</head>`)
  }

  const extraTags = [
    `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonicalUrl)}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
  ].join('\n  ')

  html = html.replace('</head>', `  ${extraTags}\n</head>`)

  return html
}

function buildSitemap(universe) {
  const urls = [
    { loc: `${SITE_ORIGIN}${BASE_PATH}`, priority: '1.0' },
    ...universe.map((item) => ({
      loc: `${SITE_ORIGIN}${BASE_PATH}stock/${item.symbol}`,
      priority: '0.7',
    })),
  ]

  const body = urls
    .map((u) => `  <url>\n    <loc>${escapeXml(u.loc)}</loc>\n    <priority>${u.priority}</priority>\n  </url>`)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
}

function buildRobots() {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}${BASE_PATH}sitemap.xml\n`
}

async function main() {
  const template = await readFile(path.join(distDir, 'index.html'), 'utf-8')
  const universe = await fetchUniverse()
  console.log(`[prerender] ${universe.length} tickers to prerender`)

  let written = 0
  for (const item of universe) {
    const html = buildTickerHtml(template, item)
    const outDir = path.join(distDir, 'stock', item.symbol)
    await mkdir(outDir, { recursive: true })
    await writeFile(path.join(outDir, 'index.html'), html, 'utf-8')
    written += 1
  }
  console.log(`[prerender] wrote ${written} ticker pages under dist/stock/*`)

  await writeFile(path.join(distDir, 'sitemap.xml'), buildSitemap(universe), 'utf-8')
  await writeFile(path.join(distDir, 'robots.txt'), buildRobots(), 'utf-8')
  console.log('[prerender] wrote sitemap.xml and robots.txt')

  // SPA fallback: GitHub Pages serves this for any path with no matching static file
  // (e.g. a ticker added after the last deploy, or `/stock/<unknown>`).
  await writeFile(path.join(distDir, '404.html'), template, 'utf-8')
  console.log('[prerender] wrote 404.html SPA fallback')
}

main().catch((error) => {
  console.error('[prerender] failed:', error)
  // Never fail the whole deploy because of this — the SPA still works without SEO pages.
  process.exitCode = 0
})
