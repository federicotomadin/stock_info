// @ts-nocheck
import fs from 'node:fs/promises'
import path from 'node:path'

// Generic disk persistence for the per-symbol Maps below (FMP fundamentals, technical
// analysis). Without this, every `npm run dev` restart wipes the in-memory cache and the
// next page view re-burns FMP's free 250 req/day quota re-fetching the same tickers.
export async function loadMapCacheFromDisk(file, targetMap, ttlMs) {
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return
    const now = Date.now()
    let loaded = 0
    for (const [symbol, entry] of Object.entries(parsed)) {
      if (entry?.savedAt && now - entry.savedAt < ttlMs) {
        targetMap.set(symbol, entry)
        loaded += 1
      }
    }
    if (loaded) {
      console.log(`Loaded ${loaded} cached entr${loaded === 1 ? 'y' : 'ies'} from ${path.basename(file)}`)
    }
  } catch {
    // No cache file yet.
  }
}

export async function saveMapCacheToDisk(file, sourceMap) {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify(Object.fromEntries(sourceMap)))
  } catch (error) {
    console.warn(`Could not persist ${path.basename(file)}:`, error?.message ?? error)
  }
}
