// Pure program/progress logic. No I/O: safe to import from server and client.
import type { ExerciseProgress, ProgressPoint, ProgressResponse, ProgramSessionView } from './api'
import type { Session } from '../../src/shared/types'

const pacificFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Today's date (YYYY-MM-DD) in Pacific time. */
export function todayPacific(now: Date = new Date()): string {
  const parts = pacificFormatter.formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/**
 * Leading prescribed weight in lb, e.g. "255 lb" -> 255, "77.5 lb" -> 77.5.
 * Returns null for anything that is not a plain weight ("80% of squat",
 * "Bodyweight", "AMRAP", undefined).
 */
const WEIGHT_RE = /^\s*(\d+(?:\.\d+)?)\s*(?:lbs?\b|$)/i

export function parseWeight(intensity: string | undefined | null): number | null {
  if (!intensity) return null
  const m = WEIGHT_RE.exec(intensity)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

function byDate(a: Session, b: Session): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : 0
}

/** Sessions sorted by date, each annotated done (date < today) or upcoming (date >= today). */
export function classifySessions(sessions: Session[], today: string): ProgramSessionView[] {
  return [...sessions].sort(byDate).map((s) => ({
    ...s,
    status: s.date < today ? 'done' : 'upcoming',
  }))
}

/** First session dated today or later, or null. */
export function nextSession(sessions: Session[], today: string): Session | null {
  const upcoming = [...sessions].sort(byDate).find((s) => s.date >= today)
  if (!upcoming) return null
  return upcoming
}

interface Entry {
  date: string
  weight: number
  completed: boolean
}

/**
 * Progress per exercise, keyed by exact (trimmed) exercise name.
 * Only exercises with a numeric prescribed weight appear, in order of first appearance.
 */
export function buildProgress(sessions: Session[], today: string): ProgressResponse {
  const ordered = [...sessions].sort(byDate)
  const entriesByName = new Map<string, Entry[]>()

  for (const session of ordered) {
    const completed = session.date < today
    const seenThisSession = new Set<string>()
    for (const ex of session.exercises ?? []) {
      const name = ex.name.trim()
      const weight = parseWeight(ex.intensity)
      if (weight === null || seenThisSession.has(name)) continue
      seenThisSession.add(name)
      const list = entriesByName.get(name) ?? []
      list.push({ date: session.date, weight, completed })
      entriesByName.set(name, list)
    }
  }

  const exercises: ExerciseProgress[] = []
  for (const [name, entries] of entriesByName) {
    const completedEntries = entries.filter((e) => e.completed)
    const points: ProgressPoint[] = completedEntries.map((e) => ({ date: e.date, weight: e.weight }))
    const firstWeight = entries[0].weight
    // Latest completed value; if none completed, the next scheduled (earliest upcoming) value.
    const currentWeight =
      completedEntries.length > 0 ? completedEntries[completedEntries.length - 1].weight : entries[0].weight
    exercises.push({
      name,
      points,
      firstWeight,
      currentWeight,
      change: currentWeight - firstWeight,
    })
  }

  return {
    completedWorkouts: ordered.filter((s) => s.date < today).length,
    exercises,
  }
}
