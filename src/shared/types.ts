export interface Exercise {
  name: string
  sets: number
  reps: string
  intensity?: string
  /** Back-off work after the top sets, display-ready, e.g. "2x5 @ 125 lb". Stays ONE exercise. */
  backoff?: string
  supersetWith?: string
  notes?: string
  coachNote?: string
  /** Optional link for lifts that share a counter or distinguish same-name variants. */
  progressionGroup?: string
  /** Optional formula for a derived load, e.g. a light squat percentage. */
  intensityFormula?: IntensityFormula
}

export interface IntensityFormula {
  sourceExercise?: string
  sourceProgressionGroup?: string
  sourceScope: 'sameWeek' | 'previous'
  factor: number
  roundToLb: number
}

export interface Session {
  date: string
  title: string
  week: number
  focus?: string
  notes?: string
  exercises: Exercise[]
}

export interface ProgramDocument {
  version: 1
  name: string
  goal?: string
  startDate: string
  weeks: number
  notes?: string
  sessions: Session[]
}

export interface Client {
  id: string
  name: string
  notes?: string | null
  createdAt: string
}

export interface ProgramFile {
  id: string
  clientId: string
  doc: ProgramDocument
}

export interface SyncEventRef {
  date: string
  eventId: string
  link: string
}

export interface SyncState {
  syncedHash: string
  syncedAt: string
  calendarId: string
  addLink: string
  events: SyncEventRef[]
}

export type SyncStatus = 'none' | 'synced' | 'changed'

export interface FileStatus {
  path: string
  state: 'modified' | 'added' | 'deleted'
}

export interface DiffLine {
  type: 'add' | 'del' | 'ctx'
  text: string
  oldLine: number | null
  newLine: number | null
}

export interface ParsedDiff {
  stats: { added: number; removed: number }
  lines: DiffLine[]
}

export interface VersionInfo {
  hash: string
  shortHash: string
  date: string
  message: string
}
