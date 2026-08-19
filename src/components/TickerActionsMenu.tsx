import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

interface TickerActionsMenuProps {
  symbol: string
  onOpenFundamentals: () => void
  onOpenTechnical: () => void
  className?: string
  /** Extra tooltip text (e.g. company sector/summary) prepended above "Abrir menú de análisis". */
  tooltip?: string
  onHover?: () => void
}

export function TickerActionsMenu({
  symbol,
  onOpenFundamentals,
  onOpenTechnical,
  className = 'ticker-link',
  tooltip,
  onHover,
}: TickerActionsMenuProps) {
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
  const containerRef = useRef<HTMLSpanElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const placeMenu = useCallback(() => {
    const anchor = containerRef.current
    const menu = menuRef.current
    if (!anchor || !menu) {
      return
    }

    const anchorRect = anchor.getBoundingClientRect()
    const menuHeight = menu.offsetHeight
    const menuWidth = menu.offsetWidth
    const spaceBelow = window.innerHeight - anchorRect.bottom - 8
    const openUp = spaceBelow < menuHeight && anchorRect.top > menuHeight + 8

    let left = anchorRect.left
    if (left + menuWidth > window.innerWidth - 16) {
      left = window.innerWidth - menuWidth - 16
    }
    left = Math.max(16, left)

    setMenuStyle({
      position: 'fixed',
      left,
      top: openUp ? anchorRect.top - menuHeight - 6 : anchorRect.bottom + 6,
      minWidth: Math.max(anchorRect.width, 220),
      zIndex: 1000,
    })
  }, [])

  useLayoutEffect(() => {
    if (!open) {
      return undefined
    }

    placeMenu()
    window.addEventListener('resize', placeMenu)
    window.addEventListener('scroll', placeMenu, true)
    return () => {
      window.removeEventListener('resize', placeMenu)
      window.removeEventListener('scroll', placeMenu, true)
    }
  }, [open, placeMenu])

  useEffect(() => {
    if (!open) {
      return undefined
    }

    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node
      if (containerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return
      }
      setOpen(false)
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  return (
    <span className="ticker-actions" ref={containerRef} onMouseEnter={onHover}>
      <button
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title={tooltip ? `${tooltip}\n\nAbrir menú de análisis` : 'Abrir menú de análisis'}
      >
        {symbol}
      </button>
      {open ? (
        <div ref={menuRef} className="ticker-menu ticker-menu-floating" role="menu" style={menuStyle}>
          <button
            type="button"
            role="menuitem"
            className="ticker-menu-item"
            onClick={() => {
              setOpen(false)
              onOpenFundamentals()
            }}
          >
            <span className="ticker-menu-item-title">Fundamentals</span>
            <span className="ticker-menu-item-subtitle">Métricas FMP (P/E, ROE, DCF…)</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="ticker-menu-item"
            onClick={() => {
              setOpen(false)
              onOpenTechnical()
            }}
          >
            <span className="ticker-menu-item-title">Análisis técnico</span>
            <span className="ticker-menu-item-subtitle">SMA, RSI, soportes y lectura AI</span>
          </button>
        </div>
      ) : null}
    </span>
  )
}
