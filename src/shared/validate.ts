const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function validateProgram(doc: unknown): string[] {
  const errors: string[] = []
  if (doc === null || typeof doc !== 'object') return ['not an object']
  const d = doc as Record<string, unknown>

  if (d.version !== 1) errors.push('version: must be 1')
  if (typeof d.name !== 'string' || d.name.length === 0) errors.push('name: required string')
  if (typeof d.startDate !== 'string' || !DATE_RE.test(d.startDate)) errors.push('startDate: must be YYYY-MM-DD')
  if (typeof d.weeks !== 'number' || !Number.isInteger(d.weeks) || d.weeks < 1) errors.push('weeks: positive integer required')
  if (!Array.isArray(d.sessions) || d.sessions.length === 0) errors.push('sessions: non-empty array required')

  const weeks = typeof d.weeks === 'number' ? d.weeks : 0
  const sessions = Array.isArray(d.sessions) ? d.sessions : []

  sessions.forEach((s, i) => {
    const sess = s as Record<string, unknown>
    if (typeof sess.date !== 'string' || !DATE_RE.test(sess.date)) errors.push(`sessions[${i}].date: must be YYYY-MM-DD`)
    if (typeof sess.title !== 'string' || sess.title.length === 0) errors.push(`sessions[${i}].title: required string`)
    if (typeof sess.week !== 'number' || !Number.isInteger(sess.week) || sess.week < 1 || sess.week > weeks) {
      errors.push(`sessions[${i}].week: must be integer in 1..${weeks}`)
    }
    if (!Array.isArray(sess.exercises) || sess.exercises.length === 0) {
      errors.push(`sessions[${i}].exercises: non-empty array required`)
    }
    const exercises = Array.isArray(sess.exercises) ? sess.exercises : []
    exercises.forEach((e, j) => {
      const ex = e as Record<string, unknown>
      if (typeof ex.name !== 'string' || ex.name.length === 0) errors.push(`sessions[${i}].exercises[${j}].name: required string`)
      if (typeof ex.sets !== 'number' || !Number.isInteger(ex.sets) || ex.sets < 1) {
        errors.push(`sessions[${i}].exercises[${j}].sets: positive integer required`)
      }
      if (typeof ex.reps !== 'string' || ex.reps.length === 0) errors.push(`sessions[${i}].exercises[${j}].reps: required string`)
    })
  })

  return errors
}
