// End-to-end upload flow against a temp media dir: create -> chunks -> complete
// -> transcode -> publish -> duplicate guard -> delete. ffmpeg is required.
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
let bytes: Buffer

beforeAll(async () => {
  execFileSync('ffmpeg', [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=24', '-t', '1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', SOURCE,
  ])
  bytes = readFileSync(SOURCE)
  ;({ handleUploadRoutes } = await import('./uploads.ts'))
  ;({ listVideos, publishVideo, deleteVideo } = await import('./videos.ts'))
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

function req(pathname: string, init: RequestInit = {}, resolve: UploadResolver = ben) {
  return handleUploadRoutes(new Request(`http://localhost${pathname}`, init), resolve)
}

async function uploadAll(): Promise<string> {
  const created = (await req('/api/uploads', {
    method: 'POST',
    body: JSON.stringify({ filename: 'clip.mp4', size: bytes.length }),
    headers: { 'content-type': 'application/json' },
  }))!
  expect(created.status).toBe(201)
  const { uploadId } = (await created.json()) as { uploadId: string }

  const step = Math.ceil(bytes.length / 3)
  const offsets: number[] = []
  for (let offset = 0; offset < bytes.length; offset += step) offsets.push(offset)
  // Out of order and concurrent on purpose: the server writes at each offset and
  // merges received ranges, so neither order nor overlap matters.
  const responses = await Promise.all(
    offsets.reverse().map((offset) => {
      const chunk = new Uint8Array(bytes.subarray(offset, Math.min(offset + step, bytes.length)))
      return req(`/api/uploads/${uploadId}/chunk?offset=${offset}`, { method: 'PUT', body: chunk })
    }),
  )
  for (const res of responses) expect(res!.status).toBe(200)

  const done = (await req(`/api/uploads/${uploadId}/complete`, { method: 'POST' }))!
  expect(done.status).toBe(201)
  const body = (await done.json()) as { videoId: string }
  return body.videoId
}

async function waitForDraft(id: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const db = new Database(path.join(dir, 'index.sqlite'), { readonly: true })
    const row = db.query('SELECT status FROM videos WHERE id = ?').get(id) as { status: string } | null
    db.close()
    if (row?.status === 'draft') return
    if (row?.status === 'failed') throw new Error('transcode failed')
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('timed out waiting for draft')
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

  test('chunks, completes, transcodes, publishes, then deletes', async () => {
    const videoId = await uploadAll()
    await waitForDraft(videoId)

    const drafts = listVideos('ben', { all: true })
    expect(drafts.some((v) => v.id === videoId)).toBe(true)
    expect(listVideos('ben').some((v) => v.id === videoId)).toBe(false)

    expect(publishVideo('ben', videoId)).toBe('ok')
    expect(listVideos('ben').some((v) => v.id === videoId)).toBe(true)

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

  test('refuses a second published clip for the same exercise and day', async () => {
    const videoId = await uploadAll()
    await waitForDraft(videoId)
    expect(publishVideo('ben', videoId)).toBe('ok')

    // A second draft with the same day/exercise, as if a duplicate label was submitted.
    const db = new Database(path.join(dir, 'index.sqlite'))
    const first = db.query('SELECT shot_date, exercise FROM videos WHERE id = ?').get(videoId) as {
      shot_date: string
      exercise: string
    }
    db.query(
      `INSERT INTO videos (id, client_id, shot_date, shot_at, exercise, rel_path, poster_path, sha256, source, status, created_at)
       VALUES ('dupe00000001', 'ben', ?, '2026-10-01T00:00:00Z', ?, 'x.mp4', 'x.jpg', 'different-hash', 'test', 'draft', ?)`,
    ).run(first.shot_date, first.exercise, new Date().toISOString())
    db.close()

    expect(publishVideo('ben', 'dupe00000001')).toBe('duplicate')
    expect(deleteVideo('ben', videoId)).toBe('ok')
  })
})
