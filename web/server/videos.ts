// Video index reads and authenticated media streaming.
//
// Media lives OUTSIDE the repo (default /srv/coach-media, /media in the container).
// The index is a SQLite file written only by scripts/videos/*.ts. This module opens
// it read-only and never exposes filesystem paths to the client or to the request.
import { Database } from 'bun:sqlite'
import path from 'node:path'
import type { VideoItem, VideosResponse } from '../shared/api'
import { getClientId, type ClientSession } from './auth.ts'

export const DEFAULT_MEDIA_DIR = '/srv/coach-media'

/** In the container the host media dir is mounted at /media; scripts on the host use /srv. */
export function mediaDir(): string {
  if (process.env.MEDIA_DIR) return process.env.MEDIA_DIR
  return process.env.NODE_ENV === 'production' ? '/media' : DEFAULT_MEDIA_DIR
}

interface VideoRow {
  id: string
  client_id: string
  shot_date: string
  shot_at: string | null
  exercise: string
  weight: number | null
  sets: number | null
  reps: string | null
  set_index: number | null
  notes: string | null
  rel_path: string
  poster_path: string | null
  duration_s: number | null
  created_at: string
}

let cached: { dir: string; db: Database | null } | null = null

function openDb(): Database | null {
  const dir = mediaDir()
  if (cached?.dir === dir) return cached.db
  let db: Database | null = null
  try {
    db = new Database(path.join(dir, 'index.sqlite'), { readonly: true })
  } catch {
    db = null
  }
  cached = { dir, db }
  return db
}

function toItem(row: VideoRow): VideoItem {
  return {
    id: row.id,
    date: row.shot_date,
    exercise: row.exercise,
    weight: row.weight,
    sets: row.sets,
    reps: row.reps,
    setIndex: row.set_index,
    notes: row.notes ?? undefined,
    durationS: row.duration_s,
    createdAt: row.created_at,
    videoUrl: `/api/videos/${encodeURIComponent(row.id)}`,
    posterUrl: `/api/videos/${encodeURIComponent(row.id)}/poster`,
  }
}

/** All videos for one client, newest first. Empty when the index does not exist yet. */
export function listVideos(clientId: string): VideoItem[] {
  const db = openDb()
  if (!db) return []
  try {
    const rows = db
      .query(
        `SELECT id, client_id, shot_date, shot_at, exercise, weight, sets, reps, set_index,
                notes, rel_path, poster_path, duration_s, created_at
           FROM videos WHERE client_id = ? ORDER BY shot_date DESC, shot_at DESC, created_at DESC`,
      )
      .all(clientId) as VideoRow[]
    return rows.map(toItem)
  } catch {
    return []
  }
}

function findVideo(clientId: string, id: string): VideoRow | null {
  const db = openDb()
  if (!db) return null
  try {
    return (db
      .query(
        `SELECT id, client_id, shot_date, shot_at, exercise, weight, sets, reps, set_index,
                notes, rel_path, poster_path, duration_s, created_at
           FROM videos WHERE client_id = ? AND id = ?`,
      )
      .get(clientId, id) as VideoRow | null) ?? null
  } catch {
    return null
  }
}

/** Resolve a stored relative path, refusing anything that escapes the media directory. */
function resolveMedia(relPath: string): string | null {
  const root = path.resolve(mediaDir())
  const full = path.resolve(root, relPath)
  return full.startsWith(root + path.sep) ? full : null
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
}

function serveFile(request: Request, filePath: string): Response {
  const file = Bun.file(filePath)
  const type = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  const base: Record<string, string> = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=86400',
  }

  const range = request.headers.get('range')
  if (!range) {
    const headers = new Headers(base)
    if (file.size) headers.set('Content-Length', String(file.size))
    return new Response(request.method === 'HEAD' ? null : file, { headers })
  }

  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (!m || (m[1] === '' && m[2] === '')) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${file.size}` } })
  }
  const size = file.size
  let start: number
  let end: number
  if (m[1] === '') {
    const suffix = Number(m[2])
    if (!Number.isFinite(suffix) || suffix <= 0) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  if (!Number.isFinite(start) || start > end || start >= size) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  }

  const headers = new Headers(base)
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
  headers.set('Content-Length', String(end - start + 1))
  const body = request.method === 'HEAD' ? null : file.slice(start, end + 1)
  return new Response(body, { status: 206, headers })
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' },
  })
}

export type VideoResolver = (req: Request) => Promise<ClientSession | null>

/**
 * Handles /api/me/videos and /api/videos/:id[/poster]. Returns null for unrelated paths.
 * Identity always comes from the injected resolver; ids are always re-scoped to that client.
 */
export async function handleVideoRoutes(
  request: Request,
  resolve: VideoResolver = getClientId,
): Promise<Response | null> {
  const url = new URL(request.url)
  const isList = url.pathname === '/api/me/videos'
  const media = /^\/api\/videos\/([^/]+)(\/poster)?$/.exec(url.pathname)
  if (!isList && !media) return null

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8', Allow: 'GET, HEAD' },
    })
  }

  const me = await resolve(request)
  if (!me) return json({ error: 'unauthorized' }, 401)

  if (isList) {
    const body: VideosResponse = { videos: listVideos(me.clientId) }
    return json(body)
  }

  const id = decodeURIComponent(media![1])
  const row = findVideo(me.clientId, id)
  if (!row) return json({ error: 'not_found' }, 404)

  const rel = media![2] ? row.poster_path : row.rel_path
  if (!rel) return json({ error: 'not_found' }, 404)
  const filePath = resolveMedia(rel)
  if (!filePath) return json({ error: 'not_found' }, 404)

  const file = Bun.file(filePath)
  if (!(await file.exists())) return json({ error: 'not_found' }, 404)
  return serveFile(request, filePath)
}
