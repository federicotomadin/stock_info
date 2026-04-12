/** En producción (GitHub Pages), apunta al backend desplegado; en local déjalo vacío y usa el proxy de Vite. */
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/$/, '')

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
