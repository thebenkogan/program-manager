import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ProgramFile } from '../src/shared/types'
import { validateProgram } from '../src/shared/validate'

const ROOT = path.resolve(import.meta.dirname, '..')
const dir = path.join(ROOT, 'data', 'programs')

const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
let failed = false

for (const f of files) {
  const program = JSON.parse(readFileSync(path.join(dir, f), 'utf-8')) as ProgramFile
  const errors = validateProgram(program.doc)
  if (errors.length > 0) {
    failed = true
    console.error(`✗ ${program.id}`)
    for (const e of errors) console.error(`   - ${e}`)
  } else {
    console.log(`✓ ${program.id} — ${program.doc.name}, ${program.doc.sessions.length} sessions`)
  }
}

if (failed) process.exit(1)
console.log(`${files.length} program(s) valid`)
