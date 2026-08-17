/** Lightweight document-head updater for per-ticker SEO (no react-helmet dependency). */

interface SeoTags {
  title: string
  description: string
  /** Path relative to the app base, e.g. `stock/AAPL` (no leading slash). */
  path: string
}

function setMetaTag(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function setCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', 'canonical')
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

export function applySeoTags({ title, description, path }: SeoTags) {
  if (typeof document === 'undefined') {
    return
  }

  document.title = title
  setMetaTag('name', 'description', description)
  setMetaTag('property', 'og:title', title)
  setMetaTag('property', 'og:description', description)
  setMetaTag('property', 'og:type', 'website')
  setMetaTag('name', 'twitter:card', 'summary')
  setMetaTag('name', 'twitter:title', title)
  setMetaTag('name', 'twitter:description', description)

  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  const cleanPath = `${base}/${path}`.replace(/\/+/g, '/')
  setCanonical(new URL(cleanPath, window.location.origin).toString())
}

/** Restore the app's default (non-ticker) head tags, e.g. when navigating back to the screener. */
export function resetSeoTags() {
  applySeoTags({
    title: 'Stock Screener - Performance Dashboard',
    description: 'Browse, filter, and sort stocks by 1D, 1M, 1Y performance and trend signals.',
    path: '',
  })
}
