// Shared helpers for the video ingest scripts. These run on the HOST, never in
// the web container: they shell out to ffmpeg and are the only writers of the
// SQLite index. The web app opens the index read-only.
import { Database } from 'bun:sqlite'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { ensureVideoSchema } from '../../web/shared/video-schema.ts'
import { todayPacific } from '../../web/shared/progress.ts'
import type { Exercise, ProgramFile } from '../../src/shared/types'

export const ROOT = path.resolve(import.meta.dirname, '../..')
export const DEFAULT_MEDIA_DIR = '/srv/coach-media'
export const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.3gp'])

export function mediaDir(): string {
  return process.env.MEDIA_DIR || DEFAULT_MEDIA_DIR
}

export function openIndex(write: boolean): Database {
  const dir = mediaDir()
  if (write) mkdirSync(dir, { recursive: true })
  const db = new Database(path.join(dir, 'index.sqlite'), write ? undefined : { readonly: true })
  if (write) {
    db.exec('PRAGMA journal_mode = WAL;')
    ensureVideoSchema(db)
  }
  return db
}

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

export interface Probe {
  durationS: number
  width: number
  height: number
  shotAt: string | null
  bytes: number
}

interface FfprobeJson {
  format?: { duration?: string; tags?: Record<string, string> }
  streams?: { codec_type?: string; width?: number; height?: number; tags?: Record<string, string> }[]
}

/** Probe a video: dimensions, duration, and capture time (ISO, UTC). */
export function probe(file: string): Probe {
  const raw = execFileSync(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  )
  const data = JSON.parse(raw) as FfprobeJson
  const video = data.streams?.find((s) => s.codec_type === 'video')
  const tags = { ...(data.format?.tags ?? {}), ...(video?.tags ?? {}) }
  const created =
    tags['creation_time'] ?? tags['com.apple.quicktime.creationdate'] ?? tags['date'] ?? null
  return {
    durationS: Number(data.format?.duration ?? 0) || 0,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    shotAt: created && !Number.isNaN(new Date(created).getTime()) ? new Date(created).toISOString() : null,
    bytes: statSync(file).size,
  }
}

const FILENAME_DATE = /(?:VID|PXL|IMG|MOV|VIDEO)[_-]?(\d{8})[_-](\d{6})/i

/** Capture time from metadata, else the Android filename, else mtime. Returns ISO UTC. */
export function captureTime(file: string, p: Probe): string {
  if (p.shotAt) return p.shotAt
  const m = FILENAME_DATE.exec(path.basename(file))
  if (m) {
    const [, d, t] = m
    const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`
    const parsed = new Date(iso)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return statSync(file).mtime.toISOString()
}

/** Pacific calendar date for an ISO timestamp. */
export function pacificDate(iso: string): string {
  return todayPacific(new Date(iso))
}

export function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

export interface ClientProgram {
  clientId: string
  doc: ProgramFile['doc']
}

/** Read a client's program from the working tree (ingest sees pending edits). */
export function readProgram(clientId: string): ClientProgram | null {
  const dir = path.join(ROOT, 'data', 'programs')
  if (!existsSync(dir)) return null
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    try {
      const file = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as ProgramFile
      if (file.clientId === clientId && file.doc) return { clientId, doc: file.doc }
    } catch {
      // ignore malformed files; validate.ts owns that
    }
  }
  return null
}

export function sessionOn(doc: ProgramFile['doc'], date: string): ProgramFile['doc']['sessions'][number] | null {
  return doc.sessions.find((s) => s.date === date) ?? null
}

export function nearestSession(doc: ProgramFile['doc'], date: string, maxDays = 3) {
  const target = new Date(`${date}T12:00:00Z`).getTime()
  let best: { session: (typeof doc.sessions)[number]; days: number } | null = null
  for (const session of doc.sessions) {
    const days = Math.abs(new Date(`${session.date}T12:00:00Z`).getTime() - target) / 86_400_000
    if (days <= maxDays && (!best || days < best.days)) best = { session, days }
  }
  return best
}

const ALIASES: Record<string, string[]> = {
  squat: ['squat'],
  bench: ['bench'],
  press: ['press', 'ohp'],
  deadlift: ['deadlift', 'dead lift'],
  clean: ['clean'],
  jerk: ['jerk'],
  row: ['row'],
  chin: ['chin'],
  pull: ['pull'],
}

function tokens(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
}

/** Fuzzy-match a spoken exercise alias against one session's exercises. */
export function matchExercise(input: string, exercises: Exercise[]): Exercise | null {
  const q = input.toLowerCase().trim()
  const exact = exercises.find((e) => e.name.toLowerCase() === q)
  if (exact) return exact
  const partial = exercises.find((e) => e.name.toLowerCase().includes(q) || q.includes(e.name.toLowerCase()))
  if (partial) return partial

  const qTokens = tokens(q)
  let best: { exercise: Exercise; score: number } | null = null
  for (const exercise of exercises) {
    const nameTokens = new Set(tokens(exercise.name))
    let hits = 0
    for (const t of qTokens) {
      if (nameTokens.has(t)) hits += 1
      else if (ALIASES[t]?.some((a) => [...nameTokens].some((n) => n.includes(a)))) hits += 0.5
      else if ([...nameTokens].some((n) => n.includes(t))) hits += 0.5
    }
    const score = hits / qTokens.length
    if (score >= 0.5 && (!best || score > best.score)) best = { exercise, score }
  }
  return best?.exercise ?? null
}

/** Leading prescribed weight in lb, e.g. "255 lb" -> 255. */
export function weightFromIntensity(intensity: string | undefined): number | null {
  if (!intensity) return null
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:lbs?\b|$)/i.exec(intensity)
  return m ? Number(m[1]) : null
}

/** Stable id derived from the file hash. */
export function videoId(hash: string): string {
  return hash.slice(0, 12)
}

export interface Ingested {
  id: string
  date: string
  exercise: string
  weight: number | null
  sets: number | null
  reps: string | null
  web: string
  master: string
  poster: string
  durationS: number
  width: number
  height: number
  bytes: number
}

/**
 * Copy the original to _masters, transcode a 1080p-max H.264 web copy, make a
 * poster, and insert/update the index row. Idempotent on sha256.
 */
export function ingest(input: {
  file: string
  clientId: string
  date: string
  shotAt: string
  exercise: string
  weight: number | null
  sets: number | null
  reps: string | null
  setIndex?: number | null
  notes?: string | null
  source: string
  /** Only these columns are overwritten when the same file is ingested again. */
  labelFields?: ('date' | 'exercise' | 'weight' | 'sets' | 'reps' | 'set' | 'notes')[]
}): Ingested {
  const db = openIndex(true)
  const hash = sha256(input.file)
  const existing = db.query('SELECT * FROM videos WHERE sha256 = ?').get(hash) as Record<string, unknown> | null

  const id = (existing?.id as string | undefined) ?? videoId(hash)
  // Re-ingesting the same bytes must reuse the paths already indexed; recomputing
  // them from today's labels would strand the old file and create a duplicate.
  const dirRel = path.join(input.clientId, input.date)
  const exerciseSlug = slug(input.exercise) === 'unlabelled' ? 'clip' : slug(input.exercise) || 'clip'
  const base = `${input.date}_${exerciseSlug}_${
    input.weight !== null ? `${input.weight}lb` : 'unlabelled'
  }${input.sets !== null ? `_${input.sets}x${input.reps ?? '?'}` : ''}_${id}`
  const webRel = (existing?.rel_path as string | undefined) ?? path.join(dirRel, `${base}.mp4`)
  const posterRel = (existing?.poster_path as string | undefined) ?? path.join(dirRel, `${base}.jpg`)
  const masterRel =
    (existing?.master_path as string | undefined) ?? path.join('_masters', `${id}${path.extname(input.file).toLowerCase()}`)

  const p = probe(input.file)
  const abs = (rel: string) => path.join(mediaDir(), rel)
  mkdirSync(abs(dirRel), { recursive: true })
  mkdirSync(abs('_masters'), { recursive: true })

  if (!existsSync(abs(masterRel))) {
    copyFileSync(input.file, abs(masterRel))
    chmodSync(abs(masterRel), 0o444)
  }
  // Encode to a .part file and rename on success: an interrupted import must never
  // leave a truncated file that a later run mistakes for a finished one.
  const partRel = `${webRel}.part.mp4`
  if (existsSync(abs(partRel))) unlinkSync(abs(partRel))
  if (!existsSync(abs(webRel)) || !existing) {
    // Cap at 1920px on the long edge; never upscale. H.264 for universal playback.
    const scale = p.width >= p.height ? `'min(1920,iw)':-2` : `-2:'min(1920,ih)'`
    execFileSync(
      'ffmpeg',
      [
        '-v', 'error', '-y', '-i', input.file,
        '-vf', `scale=${scale}:flags=lanczos`,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-threads', '4',
        '-c:a', 'aac', '-b:a', '96k',
        '-movflags', '+faststart',
        abs(partRel),
      ],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    )
    renameSync(abs(partRel), abs(webRel))
  }
  if (!existsSync(abs(posterRel))) {
    const at = Math.min(1, Math.max(0, p.durationS / 2))
    execFileSync(
      'ffmpeg',
      ['-v', 'error', '-y', '-ss', String(at), '-i', abs(webRel), '-frames:v', '1', '-q:v', '3', abs(posterRel)],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    )
  }

  const now = new Date().toISOString()
  if (existing) {
    // Same bytes: touch ONLY fields the caller explicitly supplied. A bare re-add
    // (no labels) must never wipe labels applied earlier.
    const fields = input.labelFields ?? []
    if (fields.length > 0) {
      const value = (f: string): string | number | null => {
        switch (f) {
          case 'date': return input.date
          case 'exercise': return input.exercise
          case 'weight': return input.weight
          case 'sets': return input.sets
          case 'reps': return input.reps
          case 'set': return input.setIndex ?? null
          case 'notes': return input.notes ?? null
          default: return null
        }
      }
      const columns = fields.map((f) => (f === 'set' ? 'set_index' : f === 'date' ? 'shot_date' : f))
      db.query(`UPDATE videos SET ${columns.map((c) => `${c}=?`).join(', ')} WHERE id=?`).run(
        ...fields.map(value),
        id,
      )
    }
  } else {
    db.query(
      `INSERT INTO videos (id, client_id, shot_date, shot_at, exercise, weight, sets, reps, set_index, notes,
                           rel_path, master_path, poster_path, duration_s, width, height, bytes, sha256, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, input.clientId, input.date, input.shotAt, input.exercise, input.weight, input.sets, input.reps,
      input.setIndex ?? null, input.notes ?? null, webRel, masterRel, posterRel, p.durationS, p.width, p.height,
      p.bytes, hash, input.source, now,
    )
    const manifest = path.join(mediaDir(), 'manifest.jsonl')
    writeFileSync(
      manifest,
      `${JSON.stringify({ id, clientId: input.clientId, date: input.date, exercise: input.exercise, sha256: hash, web: webRel, master: masterRel, at: now })}\n`,
      { flag: 'a' },
    )
  }

  db.close()
  return {
    id,
    date: input.date,
    exercise: input.exercise,
    weight: input.weight,
    sets: input.sets,
    reps: input.reps,
    web: webRel,
    master: masterRel,
    poster: posterRel,
    durationS: p.durationS,
    width: p.width,
    height: p.height,
    bytes: p.bytes,
  }
}

/** Parse `--flag value` pairs; bare `--flag` becomes true. */
export function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else {
      out[key] = next
      i += 1
    }
  }
  return out
}
