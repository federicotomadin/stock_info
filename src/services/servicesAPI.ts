/**
 * URL pública del backend en producción (Render). Si cambias de servicio, actualiza aquí
 * o define VITE_API_ORIGIN en el build (GitHub Actions / .env local).
 */
const HARDCODED_PRODUCTION_API_ORIGIN =
  'https://stock-info-api-ag2h.onrender.com'

function resolveApiOrigin(): string {
  const fromEnv = (import.meta.env.VITE_API_ORIGIN ?? '').trim().replace(/\/$/, '')
  if (fromEnv) {
    return fromEnv
  }
  if (import.meta.env.PROD) {
    return HARDCODED_PRODUCTION_API_ORIGIN.replace(/\/$/, '')
  }
  return ''
}

const API_ORIGIN = resolveApiOrigin()

export function hasApiOriginConfigured(): boolean {
  return Boolean(API_ORIGIN)
}

export const apiUrl = (path: string): string => {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return API_ORIGIN ? `${API_ORIGIN}${normalized}` : normalized
}

export const apiEndpoint = (path: string): URL => {
  const full = apiUrl(path)
  if (full.startsWith('http')) {
    return new URL(full)
  }
  return new URL(full, window.location.origin)
}
