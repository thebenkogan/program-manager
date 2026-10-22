// Print the video index as JSON (for Hermes or a quick check).
//
//   bun run video:list [--client ben] [--exercise squat] [--unlabelled]
import { openIndex, parseArgs } from './lib.ts'

const args = parseArgs(process.argv.slice(2))
const clientId = typeof args.client === 'string' ? args.client : 'ben'
const db = openIndex(false)

let sql =
  'SELECT id, client_id, shot_date, exercise, weight, sets, reps, set_index, duration_s, rel_path FROM videos WHERE client_id = ?'
const params: (string | number)[] = [clientId]
if (typeof args.exercise === 'string') {
  sql += ' AND exercise LIKE ?'
  params.push(`%${args.exercise}%`)
}
if (args.unlabelled) sql += ' AND weight IS NULL AND sets IS NULL AND reps IS NULL'
sql += ' ORDER BY shot_date, shot_at'

const rows = db.query(sql).all(...params)
console.log(JSON.stringify({ clientId, count: rows.length, videos: rows }, null, 2))
db.close()
