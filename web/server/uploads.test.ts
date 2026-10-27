// End-to-end upload flow against a temp media dir: create -> chunks -> complete
// -> transcode -> auto-publish -> duplicate guard -> delete. ffmpeg is required.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { UploadResolver } from './uploads.ts'
import { Database } from 'bun:sqlite'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1:1/unused'

const dir = mkdtempSync(path.join(tmpdir(), 'coach-upload-'))
process.env.MEDIA_DIR = dir

type Uploads = typeof import('./uploads.ts')
type Videos = typeof import('./videos.ts')
let handleUploadRoutes: Uploads['handleUploadRoutes']
let listVideos: Videos['listVideos']
let publishVideo: Videos['publishVideo']
let deleteVideo: Videos['deleteVideo']

const ben = async () => ({ clientId: 'ben', clientName: 'Ben', email: 'ben@example.com' })
const anon = async (): Promise<{ clientId: string; clientName: string; email: string } | null> => null

const SOURCE = path.join(dir, 'source.mp4')
const SOURCE2 = path.join(dir, 'source2.mp4')
let bytes: Buffer
let bytes2: Buffer

beforeAll(async () => {
  execFileSync('ffmpeg', [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=24', '-t', '1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', SOURCE,
  ])
  execFileSync('ffmpeg', [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=24', '-t', '1.4',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', SOURCE2,
  ])
  bytes = readFileSync(SOURCE)
  bytes2 = readFileSync(SOURCE2)
  ;({ handleUploadRoutes } = await import('./uploads.ts'))
  ;({ listVideos, publishVideo, deleteVideo } = await import('./videos.ts'))
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

function req(pathname: string, init: RequestInit = {}, resolve: UploadResolver = ben) {
  return handleUploadRoutes(new Request(`http://localhost${pathname}`, init), resolve)
}

async function uploadAll(data: Buffer = bytes): Promise<string> {
  const created = (await req('/api/uploads', {
    method: 'POST',
    body: JSON.stringify({ filename: 'clip.mp4', size: data.length }),
    headers: { 'content-type': 'application/json' },
  }))!
  expect(created.status).toBe(201)
  const { uploadId } = (await created.json()) as { uploadId: string }

  const step = Math.ceil(data.length / 3)
  const offsets: number[] = []
  for (let offset = 0; offset < data.length; offset += step) offsets.push(offset)
  // Out of order and concurrent on purpose: the server writes at each offset and
  // merges received ranges, so neither order nor overlap matters.
  const responses = await Promise.all(
    offsets.reverse().map((offset) => {
      const chunk = new Uint8Array(data.subarray(offset, Math.min(offset + step, data.length)))
      return req(`/api/uploads/${uploadId}/chunk?offset=${offset}`, { method: 'PUT', body: chunk })
    }),
  )
  for (const res of responses) expect(res!.status).toBe(200)

  const done = (await req(`/api/uploads/${uploadId}/complete`, { method: 'POST' }))!
  expect(done.status).toBe(201)
  const body = (await done.json()) as { videoId: string }
  return body.videoId
}

async function waitForStatus(id: string, expected: 'published' | 'draft'): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const db = new Database(path.join(dir, 'index.sqlite'), { readonly: true })
    const row = db.query('SELECT status FROM videos WHERE id = ?').get(id) as { status: string } | null
    db.close()
    if (row?.status === expected) return
    if (row?.status === 'failed') throw new Error('transcode failed')
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`timed out waiting for ${expected}`)
}

describe('upload flow', () => {
  test('requires a session and rejects invalid offsets', async () => {
    expect((await req('/api/uploads', { method: 'POST', body: '{}' }, anon))!.status).toBe(401)
    const bad = (await req('/api/uploads', { method: 'POST', body: JSON.stringify({ filename: 'x.exe', size: 10 }) }))!
    expect(bad.status).toBe(415)
  })

  test('rejects out-of-range offsets and cannot complete a partial file', async () => {
    const created = (await req('/api/uploads', {
      method: 'POST',
      body: JSON.stringify({ filename: 'clip.mp4', size: bytes.length }),
      headers: { 'content-type': 'application/json' },
    }))!
    const { uploadId } = (await created.json()) as { uploadId: string }

    const beyond = (await req(`/api/uploads/${uploadId}/chunk?offset=${bytes.length + 1}`, {
      method: 'PUT',
      body: new Uint8Array([1, 2, 3]),
    }))!
    expect(beyond.status).toBe(409)
    const negative = (await req(`/api/uploads/${uploadId}/chunk?offset=-8`, {
      method: 'PUT',
      body: new Uint8Array([1, 2, 3]),
    }))!
    expect(negative.status).toBe(409)

    // Half the file: a preallocated staging file must not pass as complete.
    const half = new Uint8Array(bytes.subarray(0, Math.floor(bytes.length / 2)))
    expect((await req(`/api/uploads/${uploadId}/chunk?offset=0`, { method: 'PUT', body: half }))!.status).toBe(200)
    const early = (await req(`/api/uploads/${uploadId}/complete`, { method: 'POST' }))!
    expect(early.status).toBe(409)
    const body = (await early.json()) as { error: string; bytes: number }
    expect(body.error).toBe('incomplete')
    expect(body.bytes).toBe(half.length)
  })

  test('transcodes and publishes without a label, then deletes', async () => {
    const videoId = await uploadAll()
    await waitForStatus(videoId, 'published')

    const published = listVideos('ben').find((v) => v.id === videoId)
    expect(published?.exercise).toBe('Unlabelled')
    expect(published?.sets).toBe(1)

    const db = new Database(path.join(dir, 'index.sqlite'), { readonly: true })
    const row = db.query('SELECT rel_path, poster_path, master_path FROM videos WHERE id = ?').get(videoId) as {
      rel_path: string
      poster_path: string
      master_path: string
    }
    db.close()

    expect(deleteVideo('ben', videoId)).toBe('ok')
    for (const rel of [row.rel_path, row.poster_path, row.master_path]) {
      expect(existsSync(path.join(dir, rel))).toBe(false)
    }
  })

  test('publishes several unlabelled clips from the same day', async () => {
    const first = await uploadAll()
    const second = await uploadAll(bytes2)
    await waitForStatus(first, 'published')
    await waitForStatus(second, 'published')

    const ids = listVideos('ben').map((v) => v.id)
    expect(ids).toContain(first)
    expect(ids).toContain(second)

    expect(deleteVideo('ben', first)).toBe('ok')
    expect(deleteVideo('ben', second)).toBe('ok')
  })

  test('refuses a second published clip for the same labelled exercise and day', async () => {
    // Auto-publish stops at the unique index; the row waits as a draft for the
    // duplicate resolver. Insert the two sides directly so the publish path is isolated.
    const db = new Database(path.join(dir, 'index.sqlite'))
    const insert = db.query(
      `INSERT INTO videos (id, client_id, shot_date, shot_at, exercise, sets, reps, rel_path, poster_path, sha256, source, status, created_at)
       VALUES (?, 'ben', ?, '2026-10-02T18:00:00Z', 'Front Squat', 1, '5', ?, NULL, ?, 'test', ?, ?)`,
    )
    const now = new Date().toISOString()
    insert.run('pub000000001', '2026-10-02', 'x1.mp4', 'hash-pub', 'published', now)
    insert.run('dupe00000001', '2026-10-02', 'x2.mp4', 'hash-dupe', 'draft', now)
    db.close()

    expect(publishVideo('ben', 'dupe00000001')).toBe('duplicate')
    expect(deleteVideo('ben', 'dupe00000001')).toBe('ok')
    expect(deleteVideo('ben', 'pub000000001')).toBe('ok')
  })
})
