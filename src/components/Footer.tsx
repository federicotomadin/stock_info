import { useState, type FormEvent } from 'react'
import { apiUrl } from '../services/servicesAPI.ts'

function NewsletterSignup() {
  const [email, setEmail] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!acceptedTerms) {
      return
    }

    setStatus('loading')
    setMessage('')

    try {
      const response = await fetch(apiUrl('/api/newsletter/subscribe'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const body = await response.json()

      if (!response.ok || !body.ok) {
        setStatus('error')
        setMessage(body.error ?? 'Could not subscribe. Please try again.')
        return
      }

      setStatus('done')
      setMessage("You're in! You'll get the Top 20 every week.")
      setEmail('')
    } catch {
      setStatus('error')
      setMessage('Could not connect to the server.')
    }
  }

  return (
    <form className="footer-signup-form" onSubmit={handleSubmit}>
      <h3>Subscribe to the weekly Top 20</h3>
      <p className="footer-signup-copy">
        Get an email once a week with the 20 stocks showing the strongest trend signal on the
        screener.
      </p>
      <div className="footer-signup-row">
        <input
          type="email"
          required
          placeholder="you@email.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={status === 'loading'}
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={status === 'loading' || !acceptedTerms}
        >
          {status === 'loading' ? 'Sending…' : 'Subscribe'}
        </button>
      </div>
      <label className="footer-signup-consent">
        <input
          type="checkbox"
          checked={acceptedTerms}
          onChange={(event) => setAcceptedTerms(event.target.checked)}
        />
        <span>
          I accept the <a href="#legal-disclaimer">legal disclaimer</a>: this is not financial
          advice.
        </span>
      </label>
      {message ? (
        <p className={`status ${status === 'error' ? 'error' : 'loading'}`}>{message}</p>
      ) : null}
    </form>
  )
}

export function AppFooter() {
  return (
    <footer className="app-footer">
      <div className="footer-signups">
        <NewsletterSignup />
      </div>

      <section id="legal-disclaimer" className="legal-disclaimer">
        <h3>Legal disclaimer</h3>
        <p>
          The information, trend signals, scores and recommendations shown on this site are
          generated automatically from public market data and statistical/algorithmic models.{' '}
          <strong>They do not constitute financial, legal or tax advice</strong>, nor a
          recommendation to buy, sell or hold any financial instrument, nor an offer or
          solicitation to invest.
        </p>
        <p>
          This site is not registered as an investment adviser with any regulatory body. All
          investment decisions are the sole responsibility of the user. Past performance does not
          guarantee future results. Investing in stocks carries risk of loss, including total loss
          of the invested capital.
        </p>
        <p>
          Before making any investment decision, consult an independent, licensed financial
          advisor. Use of this site and its data is at your own risk.
        </p>
      </section>
    </footer>
  )
}
