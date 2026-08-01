import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Client, ProgramDocument, ProgramFile, Session } from '../src/shared/types'
import { validateProgram } from '../src/shared/validate'

const ROOT = path.resolve(import.meta.dirname, '..')
const DATA = path.join(ROOT, 'data')
const PROGRAMS = path.join(DATA, 'programs')

const clients: Client[] = [
  { id: 'ben', name: 'Ben', notes: null, createdAt: new Date().toISOString() },
  { id: 'andi', name: 'Andi', notes: null, createdAt: new Date().toISOString() },
]

const lifts = {
  Squat: { sets: 3, reps: '5', start: 225, inc: 5, rest: '3-5 min' },
  'Bench Press': { sets: 3, reps: '5', start: 185, inc: 2.5, rest: '3-5 min' },
  Deadlift: { sets: 1, reps: '5', start: 315, inc: 5, rest: '5 min' },
  'Overhead Press': { sets: 3, reps: '5', start: 135, inc: 2.5, rest: '3 min' },
  'Power Clean': { sets: 5, reps: '3', start: 155, inc: 5, rest: '3 min' },
} as const

const dayA: (keyof typeof lifts)[] = ['Squat', 'Bench Press', 'Deadlift']
const dayB: (keyof typeof lifts)[] = ['Squat', 'Overhead Press', 'Power Clean']

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return dt.toISOString().split('T')[0]
}

const startDate = '2026-08-03'
const sessions: Session[] = []
const counts: Record<string, number> = {}
let idx = 0
for (let week = 1; week <= 4; week++) {
  for (const day of [0, 2, 4]) {
    const title = idx % 2 === 0 ? 'Workout A' : 'Workout B'
    const liftsForDay = idx % 2 === 0 ? dayA : dayB
    const date = addDays(startDate, (week - 1) * 7 + day)
    const exercises = liftsForDay.map((name) => {
      const def = lifts[name]
      counts[name] = (counts[name] ?? 0) + 1
      const weight = def.start + (counts[name] - 1) * def.inc
      return { name, sets: def.sets, reps: def.reps, intensity: `${weight} lb`, rest: def.rest }
    })
    sessions.push({ date, title, week, exercises })
    idx++
  }
}

const doc: ProgramDocument = {
  version: 1,
  name: 'Starting Strength',
  goal: 'Novice linear progression — add weight every session.',
  startDate,
  weeks: 4,
  notes: 'Eat and sleep well. If you fail a lift, repeat the weight next session.',
  sessions,
}

const program: ProgramFile = { id: 'ben-starting-strength', clientId: 'ben', doc }

mkdirSync(PROGRAMS, { recursive: true })
writeFileSync(path.join(DATA, 'clients.json'), JSON.stringify(clients, null, 2) + '\n')
writeFileSync(path.join(PROGRAMS, `${program.id}.json`), JSON.stringify(program, null, 2) + '\n')

const errors = validateProgram(doc)
if (errors.length > 0) {
  console.error('Invalid seed program:')
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}

const exerciseRows = sessions.reduce((n, s) => n + s.exercises.length, 0)
console.log(`Seeded data/clients.json (${clients.map((c) => c.name).join(', ')})`)
console.log(`Seeded data/programs/${program.id}.json — ${program.doc.name}, ${sessions.length} sessions, ${exerciseRows} exercise rows`)
