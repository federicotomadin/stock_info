const NY_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: 'America/New_York',
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
}

function nyParts(now: Date): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-US', NY_OPTIONS)
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  )
}

function nyClock(now: Date): { weekday: string; minutes: number } {
  const parts = nyParts(now)
  return {
    weekday: parts.weekday ?? '',
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

export function nyCalendarDate(now = new Date()): string {
  const parts = nyParts(now)
  return `${parts.year}-${parts.month}-${parts.day}`
}

/** Regular NYSE/Nasdaq cash session, 09:30–16:00 America/New_York, Monday–Friday. */
export function isUsEquitySession(now = new Date()): boolean {
  const { weekday, minutes } = nyClock(now)
  if (weekday === 'Sat' || weekday === 'Sun') return false
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60
}

export function isAfterNyCashClose(now = new Date()): boolean {
  const { weekday, minutes } = nyClock(now)
  if (weekday === 'Sat' || weekday === 'Sun') return true
  return minutes >= 16 * 60 + 5
}

function shiftIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const utc = Date.UTC(year, month - 1, day + days, 12)
  return nyCalendarDate(new Date(utc))
}

function weekdayOfIsoDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(
    new Date(Date.UTC(year, month - 1, day, 12))
  )
}

export function previousWeekday(isoDate: string): string {
  let cursor = shiftIsoDate(isoDate, -1)
  while (weekdayOfIsoDate(cursor) === 'Sat' || weekdayOfIsoDate(cursor) === 'Sun') {
    cursor = shiftIsoDate(cursor, -1)
  }
  return cursor
}

/** Session to report: after 16:05 ET, today; otherwise the previous weekday. */
export function reportSessionDate(now = new Date()): string {
  const today = nyCalendarDate(now)
  const { weekday } = nyClock(now)
  if (weekday === 'Sat' || weekday === 'Sun') return previousWeekday(today)
  if (!isAfterNyCashClose(now)) return previousWeekday(today)
  return today
}

