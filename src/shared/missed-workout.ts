import type { Exercise, IntensityFormula, ProgramDocument, Session } from './types'

export type MissedWorkoutMode = 'skip' | 'defer'

type PrescriptionField = 'sets' | 'reps' | 'intensity' | 'backoff'
const PRESCRIPTION_FIELDS: PrescriptionField[] = ['sets', 'reps', 'intensity', 'backoff']
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_MS = 24 * 60 * 60 * 1000

function parseDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error(`Invalid date ${value}; expected YYYY-MM-DD`)
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (date.toISOString().slice(0, 10) !== value) throw new Error(`Invalid calendar date ${value}`)
  return date
}

function asDateString(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function weekDay(date: string): number {
  return parseDate(date).getUTCDay()
}

function titleForDate(title: string, date: string): string {
  const match = /^\w{3}\s*·\s*(.*)$/.exec(title)
  if (!match) throw new Error(`Cannot update weekday in session title: ${title}`)
  return `${DAY_NAMES[weekDay(date)]} · ${match[1]}`
}

function progressionKey(exercise: Exercise): string {
  return exercise.progressionGroup ? `group:${exercise.progressionGroup}` : `name:${exercise.name}`
}

function validateFormulas(doc: ProgramDocument): void {
  const exerciseNames = new Set(doc.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.name)))
  const progressionGroups = new Set(doc.sessions.flatMap((session) => session.exercises
    .map((exercise) => exercise.progressionGroup).filter((group): group is string => Boolean(group))))
  for (const session of doc.sessions) {
    const keys = new Set<string>()
    const groups = new Set<string>()
    for (const exercise of session.exercises) {
      if (!exercise.intensityFormula) {
        const key = progressionKey(exercise)
        if (keys.has(key)) throw new Error(`${session.date}: ${exercise.name} appears more than once in a progression sequence`)
        keys.add(key)
      }
      if (exercise.progressionGroup) {
        if (groups.has(exercise.progressionGroup)) throw new Error(`${session.date}: progressionGroup ${exercise.progressionGroup} appears more than once`)
        groups.add(exercise.progressionGroup)
      }
      if (exercise.intensityFormula) validateFormula(exercise, exerciseNames, progressionGroups)
    }
  }
}

function validateFormula(exercise: Exercise, names: Set<string>, groups: Set<string>): asserts exercise is Exercise & { intensityFormula: IntensityFormula } {
  const formula = exercise.intensityFormula!
  if (Boolean(formula.sourceExercise) === Boolean(formula.sourceProgressionGroup)) {
    throw new Error(`${exercise.name}: intensityFormula must identify exactly one sourceExercise or sourceProgressionGroup`)
  }
  if (formula.sourceExercise && (!names.has(formula.sourceExercise) || formula.sourceExercise === exercise.name)) {
    throw new Error(`${exercise.name}: intensityFormula source ${formula.sourceExercise} is missing or ambiguous`)
  }
  if (formula.sourceProgressionGroup && !groups.has(formula.sourceProgressionGroup)) {
    throw new Error(`${exercise.name}: intensityFormula source group ${formula.sourceProgressionGroup} is not used by a programmed exercise`)
  }
  if (!Number.isFinite(formula.factor) || formula.factor <= 0 || !Number.isFinite(formula.roundToLb) || formula.roundToLb <= 0) {
    throw new Error(`${exercise.name}: intensityFormula factor and roundToLb must be positive numbers`)
  }
  if (typeof exercise.intensity !== 'string') {
    throw new Error(`${exercise.name}: intensityFormula requires a concrete intensity`)
  }
}

function snapshotFields(exercise: Exercise): Partial<Record<PrescriptionField, string | number>> {
  const values: Partial<Record<PrescriptionField, string | number>> = {}
  for (const field of PRESCRIPTION_FIELDS) {
    const value = exercise[field]
    if (value !== undefined) values[field] = value
  }
  return values
}

function applyFields(exercise: Exercise, values: Partial<Record<PrescriptionField, string | number>>): void {
  for (const field of PRESCRIPTION_FIELDS) {
    const value = values[field]
    if (value === undefined) delete exercise[field]
    else (exercise as unknown as Record<string, string | number>)[field] = value
  }
}

function shiftSameExerciseAfterMiss(sessions: Session[], targetDate: string, missedExercise: Exercise): void {
  if (missedExercise.intensityFormula) return
  const key = progressionKey(missedExercise)
  const occurrences = sessions.flatMap((session) => session.exercises
    .filter((exercise) => !exercise.intensityFormula && progressionKey(exercise) === key)
    .map((exercise) => ({ session, exercise })))
    .sort((a, b) => a.session.date.localeCompare(b.session.date))
  const targetIndex = occurrences.findIndex(({ session, exercise }) => session.date === targetDate && exercise === missedExercise)
  if (targetIndex < 0) return

  let previous = snapshotFields(occurrences[targetIndex].exercise)
  for (let i = targetIndex + 1; i < occurrences.length; i++) {
    const current = snapshotFields(occurrences[i].exercise)
    applyFields(occurrences[i].exercise, previous)
    previous = current
  }
}

function roundTo(value: number, step: number): number {
  const rounded = Math.floor((value + 1e-9) / step + 0.5) * step
  return Math.round(rounded * 1000) / 1000
}

function parsePounds(intensity: string, liftName: string): number {
  const match = /^\s*(\d+(?:\.\d+)?)\s+lb\s*$/.exec(intensity)
  if (!match) throw new Error(`${liftName}: formula source intensity must be a numeric lb value, got ${intensity}`)
  return Number(match[1])
}

function formatPounds(value: number): string {
  return `${Number(value.toFixed(3))} lb`
}

function recomputeFormulas(sessions: Session[]): void {
  const ordered = [...sessions].sort((a, b) => a.date.localeCompare(b.date))
  for (const session of ordered) {
    for (const exercise of session.exercises) {
      const formula = exercise.intensityFormula
      if (!formula) continue
      const candidates = ordered.flatMap((candidateSession) => candidateSession.exercises
        .filter((candidate) => formula.sourceProgressionGroup
          ? candidate.progressionGroup === formula.sourceProgressionGroup
          : candidate.name === formula.sourceExercise)
        .map((candidate) => ({ session: candidateSession, exercise: candidate })))
        .filter(({ session: candidateSession }) => formula.sourceScope === 'sameWeek'
          ? candidateSession.week === session.week
          : candidateSession.date < session.date)
        .sort((a, b) => a.session.date.localeCompare(b.session.date))
      const source = formula.sourceScope === 'sameWeek' ? candidates[0] : candidates[candidates.length - 1]
      if (!source?.exercise.intensity) {
        const sourceName = formula.sourceExercise ?? `group ${formula.sourceProgressionGroup}`
        throw new Error(`${session.date} ${exercise.name}: no ${formula.sourceScope} source ${sourceName} with an intensity`)
      }
      const sourceLb = parsePounds(source.exercise.intensity, formula.sourceExercise ?? exercise.name)
      exercise.intensity = formatPounds(roundTo(sourceLb * formula.factor, formula.roundToLb))
    }
  }
}

function refreshWeeks(doc: ProgramDocument): void {
  doc.sessions.sort((a, b) => a.date.localeCompare(b.date))
  if (doc.sessions.length === 0) throw new Error('Adjustment would leave the program with no sessions')
  doc.startDate = doc.sessions[0].date
  const startMs = parseDate(doc.startDate).getTime()
  for (const session of doc.sessions) {
    session.week = Math.floor((parseDate(session.date).getTime() - startMs) / (7 * DAY_MS)) + 1
  }
  doc.weeks = Math.max(...doc.sessions.map((session) => session.week))
}

function inferTrainingDays(sessions: Session[]): number[] {
  return [...new Set(sessions.map((session) => weekDay(session.date)))].sort((a, b) => a - b)
}

function nextTrainingDate(date: string, cadenceWeekdays: number[]): string {
  const current = parseDate(date)
  for (let offset = 1; offset <= 7; offset++) {
    const candidate = new Date(current.getTime() + offset * DAY_MS)
    if (cadenceWeekdays.includes(candidate.getUTCDay())) return asDateString(candidate)
  }
  throw new Error('Unable to infer the next training day from scheduled sessions')
}

function deferSessions(doc: ProgramDocument, targetDate: string): void {
  const ordered = [...doc.sessions].sort((a, b) => a.date.localeCompare(b.date))
  const targetIndex = ordered.findIndex((session) => session.date === targetDate)
  if (targetIndex < 0) throw new Error(`No workout scheduled on ${targetDate}`)
  const cadenceWeekdays = inferTrainingDays(ordered)
  for (let i = targetIndex; i < ordered.length; i++) {
    const session = ordered[i]
    const nextDate = i + 1 < ordered.length
      ? ordered[i + 1].date
      : nextTrainingDate(session.date, cadenceWeekdays)
    session.date = nextDate
    session.title = titleForDate(session.title, session.date)
  }
}

export function adjustMissedWorkout(doc: ProgramDocument, targetDate: string, mode: MissedWorkoutMode): ProgramDocument {
  parseDate(targetDate)
  if (mode !== 'skip' && mode !== 'defer') throw new Error(`Unsupported missed-workout mode: ${mode}`)
  const result = structuredClone(doc)
  if (result.sessions.some((session) => !/^\d{4}-\d{2}-\d{2}$/.test(session.date))) {
    throw new Error('All session dates must use YYYY-MM-DD')
  }
  const duplicateDate = result.sessions.find((session, index, all) => all.findIndex((other) => other.date === session.date) !== index)
  if (duplicateDate) throw new Error(`Multiple workouts are scheduled on ${duplicateDate.date}`)
  if (!result.sessions.some((session) => session.date === targetDate)) {
    throw new Error(`No workout scheduled on ${targetDate}`)
  }
  validateFormulas(result)

  if (mode === 'skip') {
    const target = result.sessions.find((session) => session.date === targetDate)!
    for (const exercise of target.exercises) shiftSameExerciseAfterMiss(result.sessions, targetDate, exercise)
    result.sessions = result.sessions.filter((session) => session.date !== targetDate)
  } else {
    deferSessions(result, targetDate)
  }

  refreshWeeks(result)
  recomputeFormulas(result.sessions)
  return result
}
