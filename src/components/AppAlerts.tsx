import { RENDER_POSTGRES_DOCS_URL } from '../constants/app'

interface AppAlertsProps {
  unsubscribeMessage: string
  dbConnectionError: string
  showDbExpiryAlert: boolean
  dbExpiryLabel: string | null
}

export function AppAlerts({
  unsubscribeMessage,
  dbConnectionError,
  showDbExpiryAlert,
  dbExpiryLabel,
}: AppAlertsProps) {
  const hasSecondaryAlerts = showDbExpiryAlert || Boolean(dbConnectionError)

  return (
    <>
      {unsubscribeMessage ? (
        <div className="app-alerts">
          <div className="app-alert info" role="status">
            <span className="app-alert-icon" aria-hidden="true">
              i
            </span>
            <p>{unsubscribeMessage}</p>
          </div>
        </div>
      ) : null}
      {hasSecondaryAlerts ? (
        <div className="app-alerts">
          {dbConnectionError ? (
            <div className="app-alert warn" role="alert">
              <span className="app-alert-icon" aria-hidden="true">
                !
              </span>
              <p>
                PostgreSQL is not reachable, so the screener cannot read cached quotes. Start it
                locally with <code>npm run db:up</code>, or in production recreate the Render
                Postgres instance and set <code>DATABASE_URL</code> on the API.
                <span className="app-alert-detail">{dbConnectionError}</span>
              </p>
            </div>
          ) : null}
          {showDbExpiryAlert ? (
            <div className="app-alert info" role="status">
              <span className="app-alert-icon" aria-hidden="true">
                i
              </span>
              <p>
                Your database will expire on <strong>{dbExpiryLabel}</strong>. The database will be
                deleted unless you{' '}
                <a href={RENDER_POSTGRES_DOCS_URL} target="_blank" rel="noreferrer noopener">
                  upgrade to a paid instance type
                </a>
                .
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
