// Scan a folder of unlabelled clips and propose labels. Read-only: it writes a
// review CSV, not the index. Approve rows later with video:add / video:label.
//
//   bun run video:scan ~/coach-video-inbox --client ben [--csv review.csv]
//
// Dates come from capture metadata (falling back to Android's VID_ filename,
// then mtime). A clip whose date has a program session inherits that session's
// exercise order and prescribed weights; a clip with no session — pre-program
// footage or an off-program lift — is proposed as Unlabelled so nothing is lost.
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  VIDEO_EXTS,
  captureTime,
  pacificDate,
  parseArgs,
  probe,
  readProgram,
  sessionOn,
  weightFromIntensity,
} from './lib.ts'

const args = parseArgs(process.argv.slice(2))
const positional = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : ''
const root = path.resolve(
  typeof args.dir === 'string' ? args.dir : positional || path.join(process.env.HOME ?? '.', 'coach-video-inbox'),
)
if (!existsSync(root)) {
  console.error(`not a directory: ${root}`)
  process.exit(2)
}
const clientId = typeof args.client === 'string' ? args.client : 'ben'
const program = readProgram(clientId)

function walk(directory: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...walk(full))
    else if (VIDEO_EXTS.has(path.extname(entry).toLowerCase())) out.push(full)
  }
  return out
}

interface Row {
  file: string
  shotAt: string
  date: string
  session: string
  exercise: string
  weight: number | null
  sets: number | null
  reps: string | null
  note: string
}

const clips = walk(root).map((file) => {
  const p = probe(file)
  const shotAt = captureTime(file, p)
  return { file, shotAt, date: pacificDate(shotAt), duration: p.durationS, width: p.width, height: p.height }
})

const byDate = new Map<string, typeof clips>()
for (const clip of clips.sort((a, b) => a.shotAt.localeCompare(b.shotAt))) {
  const list = byDate.get(clip.date)
  if (list) list.push(clip)
  else byDate.set(clip.date, [clip])
}

const rows: Row[] = []
for (const [date, list] of [...byDate.entries()].sort()) {
  const session = program ? sessionOn(program.doc, date) : null
  list.forEach((clip, i) => {
    if (!session) {
      rows.push({ ...clip, session: '—', exercise: 'Unlabelled', weight: null, sets: null, reps: null, note: 'no session this date' })
      return
    }
    const ex = session.exercises.length === list.length ? session.exercises[i] : null
    if (!ex) {
      rows.push({
        ...clip,
        session: session.title,
        exercise: 'Unlabelled',
        weight: null,
        sets: null,
        reps: null,
        note: `${list.length} clip(s) vs ${session.exercises.length} exercises`,
      })
      return
    }
    rows.push({
      ...clip,
      session: session.title,
      exercise: ex.name,
      weight: weightFromIntensity(ex.intensity),
      sets: ex.sets,
      reps: ex.reps,
      note: 'by order',
    })
  })
}

const csv = [
  'file,shot_at,date,session,exercise,weight,sets,reps,note',
  ...rows.map((r) =>
    [r.file, r.shotAt, r.date, r.session, r.exercise, r.weight ?? '', r.sets ?? '', r.reps ?? '', r.note]
      .map((v) => `"${String(v).replaceAll('"', '""')}"`)
      .join(','),
  ),
].join('\n')

const csvPath = typeof args.csv === 'string' ? path.resolve(args.csv) : path.join(root, 'review.csv')
writeFileSync(csvPath, `${csv}\n`)
console.log(csv)
console.error(`\n${rows.length} clip(s) → ${csvPath}`)
