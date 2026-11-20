#!/usr/bin/env npx tsx
/**
 * Headlines for veto / manual checks — Node fetch (avoids macOS Python SSL issues).
 * Usage: npm run trader:news -- --tickers AAPL --hours 12
 */
import 'dotenv/config'
import { fetchYahooHeadlinesBrief } from '../server/agent/yahooHeadlines.js'

const argv = process.argv.slice(2)
let tickers: string[] = []
let hours = 12

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i]
  if (arg === '--tickers') {
    while (argv[i + 1] && !argv[i + 1]!.startsWith('--')) {
      tickers.push(argv[++i]!)
    }
  } else if (arg === '--hours' && argv[i + 1]) {
    hours = Number(argv[++i])
  } else if (arg === '--help' || arg === '-h') {
    console.log('Usage: npm run trader:news -- --tickers AAPL [MSFT] --hours 12')
    process.exit(0)
  }
}

if (!tickers.length) {
  console.error('Pass --tickers SYMBOL (e.g. --tickers AAPL)')
  process.exit(2)
}

const now = new Date().toLocaleString('en-US', {
  timeZone: 'America/New_York',
  dateStyle: 'short',
  timeStyle: 'short',
})

for (const symbol of tickers) {
  console.log(`--- ${symbol.toUpperCase()} ---`)
  const brief = await fetchYahooHeadlinesBrief(symbol, hours)
  console.log(brief ?? 'No data.')
  console.log('')
}

console.log(
  `Checked ${now} ET. Headlines are leads, not facts. SEC 8-K: npm run trader:news:py -- --tickers SYMBOL (needs trader/config.json from sync-trader-config).`
)