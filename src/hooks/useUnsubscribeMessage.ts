import { useEffect, useState } from 'react'
import { apiUrl } from '../services/servicesAPI.ts'

/** Handles the `?unsubscribe=token` newsletter link and returns a status message to show once. */
export function useUnsubscribeMessage(): string {
  const [unsubscribeMessage, setUnsubscribeMessage] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('unsubscribe')
    if (!token) {
      return
    }

    params.delete('unsubscribe')
    const url = new URL(window.location.href)
    url.search = params.toString()
    window.history.replaceState({}, '', `${url.pathname}${url.search}`)

    void fetch(apiUrl('/api/newsletter/unsubscribe'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then((response) => response.json())
      .then((body) => {
        setUnsubscribeMessage(
          body.ok
            ? 'Te dimos de baja del newsletter. Ya no vas a recibir más emails.'
            : (body.error ?? 'No se pudo procesar la baja.')
        )
      })
      .catch(() => setUnsubscribeMessage('No se pudo procesar la baja.'))
  }, [])

  return unsubscribeMessage
}
