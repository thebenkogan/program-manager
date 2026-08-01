export function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function weekday(dateStr: string): string {
  return parseDate(dateStr).toLocaleDateString('en-US', { weekday: 'short' })
}

export function monthDay(dateStr: string): string {
  return parseDate(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function fullDate(dateStr: string): string {
  return `${weekday(dateStr)}, ${monthDay(dateStr)}`
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

export function lastSessionDate(sessions: { date: string }[]): string | null {
  return sessions.length > 0 ? sessions[sessions.length - 1].date : null
}
