import { config } from 'dotenv'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
config({ path: resolve(root, '.env') })

const script = process.argv[2]
const args = process.argv.slice(3)
if (!script) {
  console.error('Usage: node scripts/run-python-with-env.mjs <script.py> [args...]')
  process.exit(2)
}

function pythonCaBundle() {
  const probe = spawnSync(
    'python3',
    ['-c', 'import certifi; print(certifi.where())'],
    { encoding: 'utf8' }
  )
  const fromCertifi = probe.stdout?.trim()
  if (probe.status === 0 && fromCertifi && existsSync(fromCertifi)) return fromCertifi

  const fallbacks = [
    '/etc/ssl/cert.pem',
    '/opt/homebrew/etc/openssl@3/cert.pem',
    '/opt/homebrew/etc/openssl@4/cert.pem',
    '/usr/local/etc/openssl@3/cert.pem',
  ]
  return fallbacks.find((path) => existsSync(path)) ?? null
}

const ca = pythonCaBundle()
const childEnv = { ...process.env }
if (ca && !childEnv.SSL_CERT_FILE) {
  childEnv.SSL_CERT_FILE = ca
  childEnv.REQUESTS_CA_BUNDLE = ca
}

const result = spawnSync('python3', [script, ...args], {
  cwd: root,
  stdio: 'inherit',
  env: childEnv,
})
process.exit(result.status ?? 1)