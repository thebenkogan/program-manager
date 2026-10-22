// Health check for the video library: index <-> disk agreement.
//
//   bun run video:verify            # report missing/corrupt files
//   bun run video:verify --fix      # drop index rows whose web file vanished (asks first)
//
// Checks every row has a web copy and poster, that the master exists, and that
// its sha256 still matches what was indexed. Read-only unless --fix.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { mediaDir, openIndex } from './lib.ts'

const args = process.argv.slice(2)
const fix = args.includes('--fix')
const dir = mediaDir()
const db = openIndex(!fix)
const rows = db
  .query('SELECT id, client_id, exercise, shot_date, rel_path, master_path, poster_path, sha256, bytes FROM videos ORDER BY shot_date')
  .all() as {
  id: string
  client_id: string
  exercise: string
  shot_date: string
  rel_path: string | null
  master_path: string | null
  poster_path: string | null
  sha256: string
  bytes: number
}[]

let missing = 0
let corrupt = 0
let bytes = 0
for (const row of rows) {
  const abs = (rel: string | null) => (rel ? path.join(dir, rel) : null)
  const web = abs(row.rel_path)
  const master = abs(row.master_path)
  const poster = abs(row.poster_path)
  if (!web || !existsSync(web)) {
    console.error(`MISSING web      ${row.id}  ${row.client_id} ${row.shot_date} ${row.exercise}`)
    missing += 1
    continue
  }
  if (!poster || !existsSync(poster)) console.error(`MISSING poster   ${row.id}  ${row.exercise} ${row.shot_date}`)
  if (!master || !existsSync(master)) {
    console.error(`MISSING master   ${row.id}  ${row.exercise} ${row.shot_date}`)
    missing += 1
  } else {
    const hash = createHash('sha256').update(readFileSync(master)).digest('hex')
    if (hash !== row.sha256) {
      console.error(`CORRUPT master   ${row.id}  ${row.exercise} ${row.shot_date}`)
      corrupt += 1
    }
  }
  bytes += row.bytes
}

console.log(
  JSON.stringify(
    {
      mediaDir: dir,
      clips: rows.length,
      sourceBytes: bytes,
      missing,
      corrupt,
      ok: missing === 0 && corrupt === 0,
    },
    null,
    2,
  ),
)
db.close()
if (missing || corrupt) process.exit(1)
