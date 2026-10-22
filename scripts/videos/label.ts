// Correct an existing clip's labels without re-encoding anything.
//
//   bun run video:label --id <id> [--date YYYY-MM-DD] [--exercise "squat"]
//                      [--weight 275] [--sets 5] [--reps 3] [--set 1] [--notes "…"]
//
// Only the flags you pass are changed. Exercise text is stored exactly as given
// (after matching it to a program name when that day has one), so off-program
// lifts are fine.
import { openIndex, parseArgs, readProgram, matchExercise, sessionOn } from './lib.ts'

const args = parseArgs(process.argv.slice(2))
const id = typeof args.id === 'string' ? args.id : ''
if (!id) {
  console.error('usage: bun run video:label --id <id> [--exercise …] [--weight …] …')
  process.exit(2)
}

const db = openIndex(true)
const row = db.query('SELECT * FROM videos WHERE id = ?').get(id) as Record<string, unknown> | null
if (!row) {
  console.error(`no video with id ${id}`)
  process.exit(1)
}

const date = typeof args.date === 'string' ? args.date : (row.shot_date as string)
const program = readProgram(row.client_id as string)
const session = program ? sessionOn(program.doc, date) : null

let exercise = row.exercise as string
if (typeof args.exercise === 'string') {
  const matched = session ? matchExercise(args.exercise, session.exercises) : null
  exercise = matched?.name ?? args.exercise
}

const weight = typeof args.weight === 'string' ? Number(args.weight) : (row.weight as number | null)
const sets = typeof args.sets === 'string' ? Number(args.sets) : (row.sets as number | null)
const reps = typeof args.reps === 'string' ? args.reps : (row.reps as string | null)
const setIndex = typeof args.set === 'string' ? Number(args.set) : (row.set_index as number | null)
const notes = typeof args.notes === 'string' ? args.notes : (row.notes as string | null)

db.query('UPDATE videos SET shot_date=?, exercise=?, weight=?, sets=?, reps=?, set_index=?, notes=? WHERE id=?').run(
  date,
  exercise,
  Number.isFinite(weight) ? weight : null,
  Number.isFinite(sets) ? sets : null,
  reps,
  setIndex,
  notes,
  id,
)
db.close()

console.log(JSON.stringify({ id, date, exercise, weight, sets, reps, setIndex, notes }, null, 2))
