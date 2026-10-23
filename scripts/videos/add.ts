// Ingest one clip. This is the ONLY write path for videos.
//
//   bun run video:add --file /path/clip.mp4 --client ben [--date 2026-10-24]
//                     [--exercise "squat"] [--weight 280] [--sets 3] [--reps 5]
//                     [--set 2] [--notes "missed 3rd"] [--source whatsapp]
//
// Missing labels are filled from the programmed session when one exists; when it
// does not (pre-program clips, off-program lifts) they stay null and the clip is
// imported as Unlabelled. Nothing is ever dropped for lack of a label.
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  captureTime,
  ingest,
  matchExercise,
  mediaDir,
  nearestSession,
  pacificDate,
  parseArgs,
  probe,
  readProgram,
  sessionOn,
  weightFromIntensity,
  type Ingested,
} from './lib.ts'

const args = parseArgs(process.argv.slice(2))
const file = typeof args.file === 'string' ? path.resolve(args.file) : ''
if (!file || !existsSync(file) || !statSync(file).isFile()) {
  console.error('usage: bun run video:add --file <path> --client <id> [labels…]')
  process.exit(2)
}

const clientId = typeof args.client === 'string' ? args.client : 'ben'
const p = probe(file)
const shotAt = captureTime(file, p)
const date = typeof args.date === 'string' ? args.date : pacificDate(shotAt)

const program = readProgram(clientId)
const session = program ? sessionOn(program.doc, date) ?? nearestSession(program.doc, date)?.session ?? null : null

let exerciseName: string | null = null
let weight = typeof args.weight === 'string' ? Number(args.weight) : null
let sets = typeof args.sets === 'string' ? Number(args.sets) : null
let reps = typeof args.reps === 'string' ? args.reps : null

if (typeof args.exercise === 'string') {
  // Match against the day's session when possible, but never require it: an
  // off-program lift keeps the name you gave it.
  const matched = session ? matchExercise(args.exercise, session.exercises) : null
  exerciseName = matched?.name ?? args.exercise
  if (matched && weight === null) weight = weightFromIntensity(matched.intensity)
  if (matched && sets === null) sets = matched.sets
  if (matched && reps === null) reps = matched.reps
} else if (session && session.exercises.length === 1) {
  exerciseName = session.exercises[0].name
  weight = weight ?? weightFromIntensity(session.exercises[0].intensity)
  sets = sets ?? session.exercises[0].sets
  reps = reps ?? session.exercises[0].reps
}

if (!exerciseName) exerciseName = 'Unlabelled'
if (weight !== null && !Number.isFinite(weight)) {
  console.error('--weight must be a number')
  process.exit(2)
}

const labelFields: ('date' | 'exercise' | 'weight' | 'sets' | 'reps' | 'set' | 'notes')[] = []
if (typeof args.date === 'string') labelFields.push('date')
if (typeof args.exercise === 'string') {
  // An explicit exercise also carries the starring labels derived from the program.
  labelFields.push('exercise', 'weight', 'sets', 'reps')
} else {
  if (typeof args.weight === 'string') labelFields.push('weight')
  if (typeof args.sets === 'string') labelFields.push('sets')
  if (typeof args.reps === 'string') labelFields.push('reps')
}
if (typeof args.set === 'string') labelFields.push('set')
if (typeof args.notes === 'string') labelFields.push('notes')

const result: Ingested = ingest({
  file,
  clientId,
  date,
  shotAt,
  exercise: exerciseName,
  weight,
  sets: sets !== null && Number.isFinite(sets) ? sets : null,
  reps,
  setIndex: typeof args.set === 'string' ? Number(args.set) : null,
  notes: typeof args.notes === 'string' ? args.notes : null,
  source: typeof args.source === 'string' ? args.source : 'manual',
  status: args.draft ? 'draft' : 'published',
  // Re-adding the same bytes with no labels must not clear previously applied ones.
  labelFields,
})

console.log(
  JSON.stringify(
    {
      ...result,
      clientId,
      shotDate: date,
      programSession: session?.date ?? null,
      programTitle: session?.title ?? null,
      mediaDir: mediaDir(),
      labelled: weight !== null || sets !== null || Boolean(reps),
    },
    null,
    2,
  ),
)
