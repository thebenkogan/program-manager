// Bulk-import a directory of clips as DRAFTS (not published). Dedupes against the
// existing index and within the batch by sha256, ignores everything that is not a
// video, and writes a CSV report so nothing disappears silently.
//
//   bun run video:import-dir ~/gym-import/Gym --client ben
//
// Drafts appear on /upload, where they can be labelled, deleted, or published.
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  VIDEO_EXTS,
  captureTime,
  ingest,
  mediaDir,
  openIndex,
  pacificDate,
  parseArgs,
  probe,
  sha256,
} from './lib.ts'

const args = parseArgs(process.argv.slice(2))
const positional = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : ''
const root = path.resolve(typeof args.dir === 'string' ? args.dir : positional)
if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`not a directory: ${root}`)
  process.exit(2)
}
const clientId = typeof args.client === 'string' ? args.client : 'ben'

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue
    const full = path.join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...walk(full))
    else if (VIDEO_EXTS.has(path.extname(entry).toLowerCase())) out.push(full)
  }
  return out.sort()
}

const files = walk(root)
console.log(`${files.length} video file(s) under ${root}`)

const db = openIndex(true)
const known = new Set((db.query('SELECT sha256 FROM videos').all() as { sha256: string }[]).map((r) => r.sha256))
db.close()

const seen = new Set<string>()
const rows: { file: string; status: string; id?: string; date?: string; note?: string }[] = []

for (const [index, file] of files.entries()) {
  const rel = path.relative(root, file)
  try {
    const hash = sha256(file)
    if (known.has(hash)) {
      rows.push({ file: rel, status: 'duplicate-library' })
      console.log(`[${index + 1}/${files.length}] skip (already in library) ${rel}`)
      continue
    }
    if (seen.has(hash)) {
      rows.push({ file: rel, status: 'duplicate-batch' })
      console.log(`[${index + 1}/${files.length}] skip (duplicate in zip) ${rel}`)
      continue
    }
    seen.add(hash)

    const p = probe(file)
    const shotAt = captureTime(file, p)
    const date = pacificDate(shotAt)
    const result = ingest({
      file,
      clientId,
      date,
      shotAt,
      exercise: 'Unlabelled',
      weight: null,
      sets: null,
      reps: null,
      source: 'import',
      status: 'draft',
    })
    rows.push({ file: rel, status: 'imported', id: result.id, date })
    console.log(`[${index + 1}/${files.length}] imported ${result.id} ${date} ${rel}`)
  } catch (error) {
    rows.push({ file: rel, status: 'error', note: String(error).slice(0, 200) })
    console.error(`[${index + 1}/${files.length}] FAILED ${rel}: ${error}`)
  }
}

const csv = [
  'file,status,id,date,note',
  ...rows.map((r) =>
    [r.file, r.status, r.id ?? '', r.date ?? '', r.note ?? ''].map((v) => `"${String(v).replaceAll('"', '""')}"`).join(','),
  ),
].join('\n')
writeFileSync(path.join(mediaDir(), 'import-report.csv'), `${csv}\n`)

const counts = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {})
console.log(JSON.stringify({ counts, report: path.join(mediaDir(), 'import-report.csv') }, null, 2))
