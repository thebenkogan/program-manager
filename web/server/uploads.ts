// Resumable chunked uploads. Clips are staged under _incoming, verified on
// completion, moved to _masters, and inserted as `processing` drafts. The web
// server never trusts a filename or path from the client beyond an extension check.
import { Database } from 'bun:sqlite'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, createReadStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { enqueueVideo } from './transcode.ts'
import { getClientId, type ClientSession } from './auth.ts'
import { mediaDir } from './videos.ts'
import { readCommittedProgram, todayPacific } from './programs.ts'
import { ensureVideoSchema } from '../shared/video-schema.ts'

const MAX_BYTES = 4 * 1024 * 1024 * 1024
const MAX_CHUNK = 12 * 1024 * 1024
const ALLOWED_EXT = new Set(['.mp4', '.mov', '.m4v', '.3gp', '.mkv', '.webm'])
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000

export type UploadResolver = (req: Request) => Promise<ClientSession | null>

interface UploadRow {
  id: string
  client_id: string
  filename: string
  ext: string
  size: number
  sha256: string | null
  bytes: number
  status: string
  video_id: string | null
  created_at: string
  expires_at: string
}

function openDb(): Database {
  mkdirSync(mediaDir(), { recursive: true })
  const db = new Database(path.join(mediaDir(), 'index.sqlite'))
  db.exec('PRAGMA journal_mode = WAL;')
  ensureVideoSchema(db)
  return db
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' },
  })
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true // native/curl clients; browsers always send it on POST/PUT
  try {
    return new URL(origin).host === new URL(request.url).host
  } catch {
    return false
  }
}

function stagingPath(id: string, ext: string): string {
  return path.join(mediaDir(), '_incoming', `${id}${ext}.part`)
}

function slug(text: string): string {
  return text.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'clip'
}

function probe(file: string): { durationS: number; width: number; height: number; shotAt: string | null } {
  const raw = execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  const data = JSON.parse(raw) as {
    format?: { duration?: string; tags?: Record<string, string> }
    streams?: { codec_type?: string; width?: number; height?: number }[]
  }
  const video = data.streams?.find((s) => s.codec_type === 'video')
  const created = data.format?.tags?.['creation_time']
  return {
    durationS: Number(data.format?.duration ?? 0) || 0,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    shotAt: created && !Number.isNaN(new Date(created).getTime()) ? new Date(created).toISOString() : null,
  }
}

function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

function defaultExercise(clientId: string, date: string, existing: string[]): string {
  const program = readCommittedProgram(clientId)
  const session = program?.doc.sessions.find((s) => s.date === date)
  if (!session) return 'Unlabelled'
  const candidates = session.exercises.map((e) => e.name).filter((name) => !existing.includes(name))
  return candidates.length === 1 ? candidates[0] : 'Unlabelled'
}

export async function handleUploadRoutes(
  request: Request,
  resolve: UploadResolver = getClientId,
): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/uploads')) return null
  if (!sameOrigin(request)) return json({ error: 'bad_origin' }, 403)

  const me = await resolve(request)
  if (!me) return json({ error: 'unauthorized' }, 401)

  const idMatch = /^\/api\/uploads\/([^/]+)(\/complete|\/chunk)?$/.exec(url.pathname)

  // Create a session.
  if (url.pathname === '/api/uploads' && request.method === 'POST') {
    let body: { filename?: unknown; size?: unknown }
    try {
      body = (await request.json()) as typeof body
    } catch {
      return json({ error: 'invalid_body' }, 400)
    }
    const filename = typeof body.filename === 'string' ? path.basename(body.filename).slice(0, 200) : ''
    const size = Number(body.size)
    const ext = path.extname(filename).toLowerCase()
    if (!filename || !ALLOWED_EXT.has(ext)) return json({ error: 'unsupported_type' }, 415)
    if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) return json({ error: 'invalid_size' }, 413)

    const db = openDb()
    // Expire abandoned sessions while we are here.
    const expired = db.query("SELECT id, ext FROM uploads WHERE status = 'receiving' AND expires_at < ?").all(
      new Date().toISOString(),
    ) as { id: string; ext: string }[]
    for (const old of expired) {
      const file = stagingPath(old.id, old.ext)
      if (existsSync(file)) unlinkSync(file)
      db.query('DELETE FROM uploads WHERE id = ?').run(old.id)
    }

    const id = crypto.randomUUID().replaceAll('-', '')
    const now = new Date()
    mkdirSync(path.join(mediaDir(), '_incoming'), { recursive: true })
    writeFileSync(stagingPath(id, ext), Buffer.alloc(0))
    db.query(
      'INSERT INTO uploads (id, client_id, filename, ext, size, bytes, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)',
    ).run(id, me.clientId, filename, ext, size, 'receiving', now.toISOString(), new Date(now.getTime() + UPLOAD_TTL_MS).toISOString())
    db.close()
    return json({ uploadId: id, chunkSize: 8 * 1024 * 1024 }, 201)
  }

  if (!idMatch) return json({ error: 'not_found' }, 404)
  const id = idMatch[1]
  const action = idMatch[2]

  const db = openDb()
  const row = db.query('SELECT * FROM uploads WHERE id = ? AND client_id = ?').get(id, me.clientId) as UploadRow | null
  if (!row) {
    db.close()
    return json({ error: 'not_found' }, 404)
  }

  if (action === '/chunk' && request.method === 'PUT') {
    if (row.status !== 'receiving') {
      db.close()
      return json({ error: 'not_receiving' }, 409)
    }
    const offset = Number(url.searchParams.get('offset'))
    if (!Number.isFinite(offset) || offset !== row.bytes) {
      db.close()
      return json({ error: 'bad_offset', bytes: row.bytes }, 409)
    }
    const length = Number(request.headers.get('content-length') ?? 0)
    if (length > MAX_CHUNK) {
      db.close()
      return json({ error: 'chunk_too_large' }, 413)
    }
    const buf = Buffer.from(await request.arrayBuffer())
    if (buf.length === 0 || row.bytes + buf.length > row.size) {
      db.close()
      return json({ error: 'bad_chunk' }, 400)
    }
    appendFileSync(stagingPath(row.id, row.ext), buf)
    db.query('UPDATE uploads SET bytes = bytes + ? WHERE id = ?').run(buf.length, id)
    const updated = db.query('SELECT bytes FROM uploads WHERE id = ?').get(id) as { bytes: number }
    db.close()
    return json({ received: updated.bytes, size: row.size })
  }

  if (action === '/complete' && request.method === 'POST') {
    db.close()
    return complete(row, me.clientId)
  }

  if (!action && request.method === 'DELETE') {
    const file = stagingPath(row.id, row.ext)
    if (existsSync(file)) unlinkSync(file)
    db.query('DELETE FROM uploads WHERE id = ?').run(id)
    db.close()
    return json({ ok: true })
  }

  if (!action && request.method === 'GET') {
    db.close()
    return json({ uploadId: row.id, bytes: row.bytes, size: row.size, status: row.status, videoId: row.video_id })
  }

  db.close()
  return json({ error: 'method_not_allowed' }, 405)
}

async function complete(row: UploadRow, clientId: string): Promise<Response> {
  const staged = stagingPath(row.id, row.ext)
  if (!existsSync(staged)) return json({ error: 'missing_staging' }, 409)
  const size = statSync(staged).size
  if (size !== row.size) return json({ error: 'incomplete', bytes: size }, 409)

  const hash = await hashFile(staged)
  const db = openDb()
  const duplicate = db.query('SELECT id FROM videos WHERE sha256 = ?').get(hash) as { id: string } | null
  if (duplicate) {
    unlinkSync(staged)
    db.query("UPDATE uploads SET status = 'duplicate', video_id = ? WHERE id = ?").run(duplicate.id, row.id)
    db.close()
    return json({ duplicate: true, videoId: duplicate.id }, 409)
  }

  // Existing exercises that day, so a lone remaining exercise can be prefilled.
  const probeResult = probe(staged)
  const shotAt = probeResult.shotAt ?? new Date().toISOString()
  const date = todayPacific(new Date(shotAt))
  const existing = (db.query('SELECT exercise FROM videos WHERE client_id = ? AND shot_date = ?').all(clientId, date) as {
    exercise: string
  }[]).map((r) => r.exercise)
  const exercise = defaultExercise(clientId, date, existing)

  const id = hash.slice(0, 12)
  const masterRel = path.join('_masters', `${id}${row.ext}`)
  const masterAbs = path.join(mediaDir(), masterRel)
  mkdirSync(path.join(mediaDir(), '_masters'), { recursive: true })
  renameSync(staged, masterAbs)

  const base = `${date}_${slug(exercise)}_unlabelled_${id}`
  const rel = path.join(clientId, date, `${base}.mp4`)
  const poster = path.join(clientId, date, `${base}.jpg`)
  mkdirSync(path.join(mediaDir(), clientId, date), { recursive: true })

  db.query(
    `INSERT INTO videos (id, client_id, shot_date, shot_at, exercise, weight, sets, reps, set_index, notes,
                         rel_path, master_path, poster_path, duration_s, width, height, bytes, sha256, source, status, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'upload', 'processing', ?)`,
  ).run(id, clientId, date, shotAt, exercise, rel, masterRel, poster, probeResult.durationS, probeResult.width, probeResult.height, size, hash, new Date().toISOString())
  db.query("UPDATE uploads SET status = 'done', video_id = ? WHERE id = ?").run(id, row.id)
  db.close()

  enqueueVideo(id)
  return json({ videoId: id, status: 'processing' }, 201)
}
