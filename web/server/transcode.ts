// In-process transcode queue. One job at a time, two encoder threads: the box is
// shared with everything else, and a poster is produced before the long encode so
// the labelling screen is usable immediately.
import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { mediaDir } from './videos.ts'

const queue: string[] = []
let draining = false

export function enqueueVideo(id: string): void {
  if (!queue.includes(id)) queue.push(id)
  void drain()
}

/** Resume rows left in `processing` after a restart. */
export function resumePending(): void {
  try {
    const db = new Database(path.join(mediaDir(), 'index.sqlite'), { readonly: true })
    const rows = db.query("SELECT id FROM videos WHERE status = 'processing'").all() as { id: string }[]
    db.close()
    for (const row of rows) enqueueVideo(row.id)
  } catch {
    // no index yet
  }
}

async function drain(): Promise<void> {
  if (draining) return
  draining = true
  while (queue.length > 0) {
    const id = queue.shift()!
    try {
      await transcode(id)
    } catch (error) {
      console.error(`transcode ${id} failed:`, error)
      mark(id, 'failed')
    }
  }
  draining = false
}

function mark(id: string, status: string): void {
  try {
    const db = new Database(path.join(mediaDir(), 'index.sqlite'))
    db.query('UPDATE videos SET status = ? WHERE id = ?').run(status, id)
    db.close()
  } catch {
    // ignore
  }
}

async function run(args: string[], timeoutMs = 15 * 60_000): Promise<void> {
  const proc = Bun.spawn(args, { stdout: 'ignore', stderr: 'pipe' })
  // Drain stderr while the process runs: ffmpeg blocks on a full pipe buffer if
  // nobody reads it, which looks exactly like a hung transcode.
  const stderr = new Response(proc.stderr).text()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
  })
  const result = await Promise.race([proc.exited, timeout])
  clearTimeout(timer)
  if (result === 'timeout') {
    proc.kill()
    await proc.exited
    throw new Error(`ffmpeg timed out after ${Math.round(timeoutMs / 1000)}s`)
  }
  const err = await stderr
  if (result !== 0) throw new Error(`ffmpeg exited ${result}: ${err.slice(0, 400)}`)
}

async function transcode(id: string): Promise<void> {
  const root = mediaDir()
  const db = new Database(path.join(root, 'index.sqlite'))
  const row = db
    .query('SELECT id, status, master_path, rel_path, poster_path, duration_s, width, height FROM videos WHERE id = ?')
    .get(id) as
    | {
        id: string
        status: string
        master_path: string | null
        rel_path: string
        poster_path: string | null
        duration_s: number | null
        width: number | null
        height: number | null
      }
    | null
  db.close()

  if (!row || row.status !== 'processing' || !row.master_path) return
  const master = path.join(root, row.master_path)
  if (!existsSync(master)) throw new Error('master missing')

  const web = path.join(root, row.rel_path)
  mkdirSync(path.dirname(web), { recursive: true })

  // Poster first (fast, single frame), so uploads become label-able immediately.
  if (row.poster_path && !existsSync(path.join(root, row.poster_path))) {
    const at = Math.min(1, Math.max(0, (row.duration_s ?? 2) / 2))
    await run(['ffmpeg', '-v', 'error', '-y', '-ss', String(at), '-i', master, '-frames:v', '1', '-q:v', '3', path.join(root, row.poster_path)])
  }

  const part = `${web}.part.mp4`
  if (existsSync(part)) unlinkSync(part)
  const width = row.width ?? 1920
  const height = row.height ?? 1080
  const scale = width >= height ? `'min(1920,iw)':-2` : `-2:'min(1920,ih)'`
  await run([
    'ffmpeg', '-v', 'error', '-y', '-i', master,
    '-vf', `scale=${scale}:flags=lanczos`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-pix_fmt', 'yuv420p', '-threads', '2',
    '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart',
    part,
  ])
  renameSync(part, web)

  // The row may have been deleted while the encoder ran.
  const check = new Database(path.join(root, 'index.sqlite'))
  const still = check.query('SELECT 1 FROM videos WHERE id = ?').get(id)
  if (!still) {
    check.close()
    for (const p of [web, row.poster_path ? path.join(root, row.poster_path) : null]) {
      if (p && existsSync(p)) unlinkSync(p)
    }
    return
  }
  const bytes = statSync(web).size
  // Publishing is independent of labelling: a finished clip goes live as
  // `Unlabelled` and gets its exercise filled in later. Only a real collision
  // (another published clip for the same exercise and day) waits as a draft for
  // the duplicate resolver on /upload.
  try {
    check
      .query(
        "UPDATE videos SET status = 'published', published_at = ?, bytes = ? WHERE id = ? AND status = 'processing'",
      )
      .run(new Date().toISOString(), bytes, id)
  } catch (error) {
    if (!String(error).includes('UNIQUE')) throw error
    check.query("UPDATE videos SET status = 'draft', bytes = ? WHERE id = ? AND status = 'processing'").run(bytes, id)
  }
  check.close()
}
