import type { ReactNode } from 'react'

interface DetailPageLayoutProps {
  title: string
  subtitle: string
  children: ReactNode
}

/** Shared header/layout for the fundamentals and technical-analysis detail pages. */
export function DetailPageLayout({ title, subtitle, children }: DetailPageLayoutProps) {
  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <h1>
            {title}
            <span className="app-header-subtitle">{subtitle}</span>
          </h1>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  )
}
