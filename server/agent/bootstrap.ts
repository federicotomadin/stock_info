import { isBrokerEnabled } from '../broker/config.js'
import { shouldAutoStartAgent } from './config.js'
import { runAgentCycle, startAgent } from './loop.js'

const WARMUP_MS = 45_000

/** Auto-start the agent interval on cloud deploy; first cycle after a short warmup. */
export function bootstrapAgentLoop(): void {
  if (!shouldAutoStartAgent() || !isBrokerEnabled()) return

  const started = startAgent()
  if ('error' in started) {
    console.warn(`Agent auto-start skipped: ${started.error}`)
    return
  }

  console.log('Agent loop auto-started (AGENT_ENABLED + RENDER or AGENT_AUTO_START).')
  setTimeout(() => {
    void runAgentCycle().then((result) => {
      console.log(`Agent initial cycle: ${result.status} — ${result.summary}`)
    })
  }, WARMUP_MS)
}