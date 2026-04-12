
/**
 * URL del backend en producción.
 * 1) VITE_API_ORIGIN (build / GitHub Actions) tiene prioridad.
 * 2) Si falta, en producción se usa src/deploy-api.json (fallback para GitHub Pages).
 * En desarrollo, sin env: rutas relativas /api → proxy de Vite.
 */
function resolveApiOrigin() {
  const fromEnv = (import.meta.env.VITE_API_ORIGIN ?? '').trim().replace(/\/$/, '')
  if (fromEnv) {
    return fromEnv
  }
  return ''
}

const API_ORIGIN = resolveApiOrigin()

/** True si hay URL de API (env, o deploy-api.json en producción). */
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
