const NY_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
}

function nyClock(now: Date): { weekday: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', NY_OPTIONS)
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  )
  return {
    weekday: parts.weekday ?? '',
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

/** Regular NYSE/Nasdaq cash session, 09:30–16:00 America/New_York, Monday–Friday. */
export function isUsEquitySession(now = new Date()): boolean {
  const { weekday, minutes } = nyClock(now)
  if (weekday === 'Sat' || weekday === 'Sun') return false
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60
}
