import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { adjustMissedWorkout, type MissedWorkoutMode } from '../../src/shared/missed-workout'
import type { ProgramFile } from '../../src/shared/types'
import { validateProgram } from '../../src/shared/validate'

const ROOT = path.resolve(import.meta.dirname, '../..')
const DATA = path.join(ROOT, 'data')

function formatDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day)))
  return `${monthName} ${day}`
}

function makeMessage(mode: MissedWorkoutMode, file: ProgramFile, date: string): string {
  if (mode === 'defer') return `Defer ${formatDate(date)} workout; move remaining sessions forward one training slot`
  const target = file.doc.sessions.find((session) => session.date === date)!
  const affected = [...new Set(target.exercises.map((exercise) => exercise.name))]
  const liftText = affected.length ? affected.join(', ') : 'scheduled lifts'
  return `Skip ${formatDate(date)} workout; shift ${liftText} prescriptions forward one exposure`
}

function describePrescription(exercise: ProgramFile['doc']['sessions'][number]['exercises'][number]): string {
  return [`${exercise.sets}x${exercise.reps}`, exercise.intensity, exercise.backoff].filter(Boolean).join(' ')
}

function printDiff(before: ProgramFile, after: ProgramFile, mode: MissedWorkoutMode, targetDate: string): void {
  if (mode === 'defer') {
    const oldSessions = [...before.doc.sessions].sort((a, b) => a.date.localeCompare(b.date))
    const newSessions = [...after.doc.sessions].sort((a, b) => a.date.localeCompare(b.date))
    const targetIndex = oldSessions.findIndex((session) => session.date === targetDate)
    for (let i = targetIndex; i < oldSessions.length; i++) {
      const oldSession = oldSessions[i]
      const newSession = newSessions[i]
      console.log(`  ${oldSession.date} -> ${newSession.date}: ${oldSession.title} -> ${newSession.title}`)
      for (let j = 0; j < Math.min(oldSession.exercises.length, newSession.exercises.length); j++) {
        const oldExercise = oldSession.exercises[j]
        const newExercise = newSession.exercises[j]
        if (describePrescription(oldExercise) !== describePrescription(newExercise)) {
          console.log(`    ${newSession.date} ${newExercise.name}: ${describePrescription(oldExercise)} -> ${describePrescription(newExercise)}`)
        }
      }
    }
    return
  }
  const beforeByDate = new Map(before.doc.sessions.map((session) => [session.date, session]))
  const afterByDate = new Map(after.doc.sessions.map((session) => [session.date, session]))
  const dates = [...new Set([...beforeByDate.keys(), ...afterByDate.keys()])].sort()
  for (const date of dates) {
    const oldSession = beforeByDate.get(date)
    const newSession = afterByDate.get(date)
    if (!oldSession) console.log(`  + ${date} ${newSession!.title}`)
    else if (!newSession) console.log(`  - ${date} ${oldSession.title}`)
    else if (JSON.stringify(oldSession) !== JSON.stringify(newSession)) {
      console.log(`  ~ ${date} ${oldSession.title} -> ${newSession.title}`)
    }
  }
  for (const session of after.doc.sessions) {
    for (const exercise of session.exercises) {
      const beforeAtDate = beforeByDate.get(session.date)?.exercises.find((candidate) => candidate.name === exercise.name)
      if (beforeAtDate && describePrescription(beforeAtDate) !== describePrescription(exercise)) {
        console.log(`    ${session.date} ${exercise.name}: ${describePrescription(beforeAtDate)} -> ${describePrescription(exercise)}`)
      }
    }
  }
}

export function runMissedWorkout(mode: MissedWorkoutMode): void {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const positional = args.filter((arg) => arg !== '--dry-run')
  if (positional.length !== 2 || !/^[a-z0-9][a-z0-9-]*$/.test(positional[0]) || !/^\d{4}-\d{2}-\d{2}$/.test(positional[1])) {
    console.error(`Usage: bun run scripts/${mode}.ts <programId> <YYYY-MM-DD> [--dry-run]`)
    process.exitCode = 2
    return
  }
  const [programId, date] = positional
  const programPath = path.join(DATA, 'programs', `${programId}.json`)
  if (!existsSync(programPath)) throw new Error(`Program not found: ${programId}`)
  const before = JSON.parse(readFileSync(programPath, 'utf8')) as ProgramFile
  if (before.id !== programId) throw new Error(`Program file id mismatch: expected ${programId}, found ${before.id}`)
  const sourceErrors = validateProgram(before.doc)
  if (sourceErrors.length) throw new Error(`Program is invalid:\n${sourceErrors.map((error) => `- ${error}`).join('\n')}`)
  const nextDoc = adjustMissedWorkout(before.doc, date, mode)
  const next: ProgramFile = { ...before, doc: nextDoc }
  const errors = validateProgram(next.doc)
  if (errors.length) throw new Error(`Adjusted program is invalid:\n${errors.map((error) => `- ${error}`).join('\n')}`)
  const message = makeMessage(mode, before, date)
  const pendingPath = path.join(DATA, 'state', 'pending', `${programId}.json`)
  if (!dryRun) {
    const dirty = execFileSync('git', ['status', '--porcelain', '--', `programs/${programId}.json`], { cwd: DATA, encoding: 'utf8' }).trim()
    if (dirty) throw new Error(`Refusing to overwrite an uncommitted program change (${programId}); review or discard it first`)
    if (existsSync(pendingPath)) throw new Error(`Refusing to overwrite existing pending message: ${pendingPath}`)
  }
  console.log(`${mode}: ${programId} on ${date}`)
  console.log(`message: ${message}`)
  printDiff(before, next, mode, date)
  if (dryRun) {
    console.log('dry run: no files changed')
    return
  }
  mkdirSync(path.dirname(pendingPath), { recursive: true })
  const tempProgramPath = `${programPath}.tmp`
  writeFileSync(tempProgramPath, `${JSON.stringify(next, null, 2)}\n`)
  renameSync(tempProgramPath, programPath)
  writeFileSync(pendingPath, `${JSON.stringify({ message }, null, 2)}\n`)
  console.log(`wrote proposed program and ${path.relative(ROOT, pendingPath)}; no commit or calendar sync performed`)
}
