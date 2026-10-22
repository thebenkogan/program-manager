// Route-level tests for the media API: auth scoping and HTTP range support.
// No Postgres is touched — identity is injected exactly like handleApi does.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { VideoResolver } from './videos.ts'
import { Database } from 'bun:sqlite'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1:1/unused'

const dir = mkdtempSync(path.join(tmpdir(), 'coach-videos-'))
process.env.MEDIA_DIR = dir

type Handler = typeof import('./videos.ts')
let handleVideoRoutes: Handler['handleVideoRoutes']

const ben = async () => ({ clientId: 'ben', clientName: 'Ben', email: 'ben@example.com' })
const andi = async () => ({ clientId: 'andi', clientName: 'Andi', email: 'andi@example.com' })
const anon = async (): Promise<{ clientId: string; clientName: string; email: string } | null> => null

const ID = 'abc123abc123'
const BODY = Buffer.from('0123456789abcdef')

beforeAll(async () => {
  mkdirSync(path.join(dir, 'ben', '2026-10-24'), { recursive: true })
  writeFileSync(path.join(dir, 'ben', '2026-10-24', `${ID}.mp4`), BODY)
  writeFileSync(path.join(dir, 'ben', '2026-10-24', `${ID}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))

  const db = new Database(path.join(dir, 'index.sqlite'))
  const { VIDEO_SCHEMA_SQL } = await import('../shared/video-schema.ts')
  db.exec(VIDEO_SCHEMA_SQL)
  db.query(
    `INSERT INTO videos (id, client_id, shot_date, shot_at, exercise, weight, sets, reps, set_index, notes,
                         rel_path, master_path, poster_path, duration_s, width, height, bytes, sha256, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    ID, 'ben', '2026-10-24', '2026-10-24T18:00:00Z', 'High Bar Back Squat', 280, 3, '5', null, null,
    `ben/2026-10-24/${ID}.mp4`, null, `ben/2026-10-24/${ID}.jpg`, 12, 1920, 1080, BODY.length, 'hash', 'test',
    new Date().toISOString(),
  )
  db.close()

  ;({ handleVideoRoutes } = await import('./videos.ts'))
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

function call(p: string, resolve: VideoResolver = ben, headers: Record<string, string> = {}) {
  return handleVideoRoutes(new Request(`http://localhost${p}`, { headers }), resolve)
}

describe('video routes', () => {
  test('lists only the session client’s videos', async () => {
    const res = (await call('/api/me/videos'))!
    expect(res.status).toBe(200)
    const body = (await res.json()) as { videos: { id: string; weight: number }[] }
    expect(body.videos).toHaveLength(1)
    expect(body.videos[0].weight).toBe(280)

    const other = (await call('/api/me/videos', andi))!
    expect(((await other.json()) as { videos: unknown[] }).videos).toHaveLength(0)
  })

  test('rejects anonymous requests', async () => {
    expect((await call('/api/me/videos', anon))!.status).toBe(401)
    expect((await call(`/api/videos/${ID}`, anon))!.status).toBe(401)
  })

  test('serves full media and byte ranges', async () => {
    const full = (await call(`/api/videos/${ID}`))!
    expect(full.status).toBe(200)
    expect(full.headers.get('accept-ranges')).toBe('bytes')
    expect(Buffer.from(await full.arrayBuffer())).toEqual(BODY)

    const part = (await call(`/api/videos/${ID}`, ben, { range: 'bytes=2-5' }))!
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe(`bytes 2-5/${BODY.length}`)
    expect(await part.text()).toBe('2345')
  })

  test('serves posters with an immutable content type', async () => {
    const res = (await call(`/api/videos/${ID}/poster`))!
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
  })

  test('never lets another client fetch by id', async () => {
    expect((await call(`/api/videos/${ID}`, andi))!.status).toBe(404)
    expect((await call(`/api/videos/does-not-exist`))!.status).toBe(404)
  })

  test('rejects ranges outside the file', async () => {
    const res = (await call(`/api/videos/${ID}`, ben, { range: 'bytes=999-' }))!
    expect(res.status).toBe(416)
  })
})
