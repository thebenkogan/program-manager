// Reconstructs a client's full training history from the data repo's git history.
// Each program block is committed to programs/<id>.json, and committing a new
// block overwrites the old sessions. The old dates survive only in git, so the
// progress page would otherwise forget every lift earned before the current block.
import type { Session } from '../../src/shared/types'

export interface ProgramVersion {
  /** Commit sha, newest last. Only used for debugging/reporting. */
  sha: string
  sessions: Session[]
}

function sorted(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** One session per date, later entries win (they reflect the latest edit). */
function dedupe(sessions: Session[]): Session[] {
  const byDate = new Map<string, Session>()
  for (const s of sessions) byDate.set(s.date, s)
  return sorted([...byDate.values()])
}

/**
 * Splits commit versions of one program file into blocks. A new block starts
 * when the incoming version no longer carries the block's first session date —
 * that is exactly what "replace the block" does (trim old dates, append new
 * ones). Edits inside a block (weight tweaks, skipped days) keep the first date,
 * so a day that was deleted for being skipped stays deleted in the final state.
 */
function blockFinals(versions: ProgramVersion[]): Session[][] {
  const finals: Session[][] = []
  let firstDate: string | null = null
  let current: Session[] = []

  for (const v of versions) {
    const sessions = v.sessions ?? []
    if (sessions.length === 0) continue
    const dates = new Set(sessions.map((s) => s.date))
    if (firstDate === null || !dates.has(firstDate)) {
      if (current.length > 0) finals.push(current)
      firstDate = sorted(sessions)[0].date
    }
    current = sessions
  }
  if (current.length > 0) finals.push(current)
  return finals
}

/**
 * All sessions ever prescribed for a client, one per date, plus the live
 * program's sessions. Old blocks are keyed by date; a date present in both the
 * live program and an old block takes the live program's version.
 */
export function mergeProgramHistory(versions: ProgramVersion[], liveSessions: Session[]): Session[] {
  const archived = blockFinals(versions).flatMap((sessions) => dedupe(sessions))
  return dedupe([...archived, ...liveSessions])
}
