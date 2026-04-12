/**
 * URL pública del backend en producción (Render). Si cambias de servicio, actualiza aquí
 * o define VITE_API_ORIGIN en el build (GitHub Actions / .env local).
 */
const HARDCODED_PRODUCTION_API_ORIGIN =
  'https://stock-info-api-ag2h.onrender.com'

/**
 * 1) VITE_API_ORIGIN tiene prioridad (secret de GitHub, etc.).
 * 2) En producción, si falta, se usa la constante de arriba.
 * En desarrollo, sin env: rutas relativas /api → proxy de Vite.
 */
function resolveApiOrigin() {
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

/** True si hay URL de API. */
export function hasApiOriginConfigured() {
  return Boolean(API_ORIGIN)
}

export const apiUrl = (path) => {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return API_ORIGIN ? `${API_ORIGIN}${normalized}` : normalized
}

export const apiEndpoint = (path) => {
  const full = apiUrl(path)
  if (full.startsWith('http')) {
    return new URL(full)
  }
  return new URL(full, window.location.origin)
}
