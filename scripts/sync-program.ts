/**
 * Headless Apply + calendar sync for a program, without the UI.
 *
 * Usage:
 *   bun run scripts/sync-program.ts <programId>            # commit pending diff (pending message) + resync calendar
 *   bun run scripts/sync-program.ts <programId> --dry-run  # show diff + what would change on the calendar
 *
 * Mirrors what the UI's Apply + Resync buttons do:
 *   - commitFile(programRelPath(id), pendingMessage)  (src/server/git.ts)
 *   - resyncProgram(doc, prevSyncState)               (src/server/calendar.ts)
 */
import { loadEnv } from 'vite'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const ROOT = process.cwd()
const DATA = path.join(ROOT, 'data')

const env = loadEnv('development', ROOT, '')
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v

const { validateProgram } = await import('../src/shared/validate.ts')
const { getProgramFile, getSyncState, writeSyncState, getPendingMessage, clearPendingMessage } =
  await import('../src/server/store.ts')
const { resyncProgram, syncProgram } = await import('../src/server/calendar.ts')

const GIT_IDENTITY = ['-c', 'user.name=coach', '-c', 'user.email=coach@local']

function git(args: string[]): string {
  return execFileSync('git', [...GIT_IDENTITY, ...args], { cwd: DATA, encoding: 'utf8' })
}

const [id, ...flags] = process.argv.slice(2)
if (!id) {
  console.error('usage: bun run scripts/sync-program.ts <programId> [--dry-run]')
  process.exit(2)
}
const dryRun = flags.includes('--dry-run')

const file = getProgramFile(id)
if (!file) {
  console.error(`no program "${id}"`)
  process.exit(1)
}

const rel = `programs/${id}.json` // git runs inside data/, so strip the data/ prefix
const errs = validateProgram(file.doc)
if (errs.length) {
  console.error('invalid program:')
  for (const e of errs) console.error(' -', e)
  process.exit(1)
}

const dirty = git(['status', '--porcelain', '--', rel]).trim()
const message = getPendingMessage(id) ?? `Update program ${file.doc.name}`
const prev = getSyncState(id)

console.log(`program: ${file.doc.name} (${id})`)
console.log(`dirty:   ${dirty ? 'yes' : 'no — nothing to commit'}`)
console.log(`sync:    ${prev ? `calendar ${prev.calendarId} (hash ${prev.syncedHash})` : 'never synced'}`)
console.log(`message: ${message}`)
if (dryRun) {
  if (dirty) console.log('\n--- diff ---\n' + git(['diff', '--no-color', '--', rel]))
  console.log('\n(dry run — no commit, no calendar changes)')
  process.exit(0)
}

let version = prev?.syncedHash ?? null
if (dirty) {
  git(['add', '--', rel])
  git(['commit', '-m', message])
  version = git(['rev-parse', 'HEAD']).trim()
  console.log(`committed ${version.slice(0, 7)}`)
  // Mirror the UI's Apply: clear the pending message once it is committed,
  // otherwise a stale message sits there and gets reused as the next
  // commit's subject.
  clearPendingMessage(id)
}

const state = prev ? await resyncProgram(file.doc, prev) : await syncProgram(file.doc)
writeSyncState(id, state)
console.log(`calendar synced: hash ${state.syncedHash}, ${state.events.length} events`)
console.log(state.addLink)
for (const e of state.events) console.log(`  ${e.date}  ${e.link}`)