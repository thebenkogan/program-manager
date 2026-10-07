// Pure formatting helpers. Dates are calendar dates (YYYY-MM-DD); they are
// formatted in UTC so no timezone shifts the day.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function toUtc(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** "Sat, Oct 3" */
export function formatDate(dateStr: string): string {
  const d = toUtc(dateStr)
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/** "Oct 3" */
export function formatShortDate(dateStr: string): string {
  const d = toUtc(dateStr)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/** "Oct 3, 2026" */
export function formatLongDate(dateStr: string): string {
  const d = toUtc(dateStr)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

/** "Sat, Oct 3" from an ISO timestamp, in Pacific time. */
export function formatExpiry(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  })
}

/** "3 x 5 @ 80%" with optional intensity. */
export function formatPrescription(sets: number, reps: string, intensity?: string): string {
  const base = `${sets} x ${reps}`
  return intensity ? `${base} @ ${intensity}` : base
}

/** "+10 lb", "-5 lb", "0 lb" */
export function formatChange(lb: number): string {
  const rounded = Math.round(lb * 10) / 10
  if (rounded === 0) return '0 lb'
  const sign = rounded > 0 ? '+' : '-'
  return `${sign}${Math.abs(rounded)} lb`
}

/** "185 lb" */
export function formatWeight(lb: number): string {
  return `${Math.round(lb * 10) / 10} lb`
}

export function pluralize(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Groups items by a numeric key, keeping first-seen key order. */
export function groupBy<T>(items: T[], key: (item: T) => number): { key: number; items: T[] }[] {
  const map = new Map<number, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = map.get(k)
    if (list) list.push(item)
    else map.set(k, [item])
  }
  return [...map.entries()].map(([k, list]) => ({ key: k, items: list }))
}

/** Validates a new password: returns an error message, or null when valid. */
export function passwordError(password: string, confirm: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.'
  if (password !== confirm) return 'Passwords do not match.'
  return null
}
