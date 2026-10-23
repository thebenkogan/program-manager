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

export interface VideoItem {
  id: string
  /** Calendar date the clip was shot (Pacific, YYYY-MM-DD). */
  date: string
  /** Canonical program exercise name, e.g. "High Bar Back Squat". */
  exercise: string
  weight: number | null
  sets: number | null
  reps: string | null
  setIndex: number | null
  notes?: string
  durationS: number | null
  /** processing = still transcoding, draft = ready but unpublished. */
  status: 'processing' | 'draft' | 'published' | 'failed'
  createdAt: string
  /** Same-origin, session-scoped media URLs. */
  videoUrl: string
  posterUrl: string
}

export interface VideosResponse {
  videos: VideoItem[]
}

export type { Exercise, Session }
