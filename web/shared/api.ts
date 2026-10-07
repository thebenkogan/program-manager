// Contract between server and client. Both sides import from here.
// All /api/me/* routes require a valid session cookie; the server resolves the
// session to a clientId and never accepts a client id from the request.
import type { Exercise, Session } from '../../src/shared/types'

export interface MeResponse {
  clientId: string
  clientName: string
  email: string
}

export interface NextWorkoutResponse {
  programName: string
  /** The next session dated today (Pacific) or later, or null when none remain. */
  session: Session | null
}

export type SessionStatus = 'done' | 'upcoming'

export interface ProgramSessionView extends Session {
  status: SessionStatus
}

export interface ProgramResponse {
  programName: string
  goal?: string
  notes?: string
  startDate: string
  weeks: number
  /** Date of the next upcoming session, or null. */
  nextDate: string | null
  sessions: ProgramSessionView[]
}

export interface ProgressPoint {
  date: string
  /** Prescribed weight in lb for that completed session. */
  weight: number
}

export interface ExerciseProgress {
  name: string
  points: ProgressPoint[]
  firstWeight: number
  /** Latest completed weight, or the next scheduled weight if none completed yet. */
  currentWeight: number
  /** currentWeight - firstWeight, in lb. Positive means heavier than the start. */
  change: number
}

export interface ProgressResponse {
  completedWorkouts: number
  exercises: ExerciseProgress[]
}

export type { Exercise, Session }
