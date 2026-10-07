import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleApi, type Resolver } from './api'
import { readCommittedClients, readCommittedProgram } from './programs'
import { todayPacific } from '../shared/progress'

const GIT_ID = ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com']
let dir = ''
let prevDataDir: string | undefined
let today = ''

const benProgram = (today: string) => ({
  id: 'ben-test',
  clientId: 'ben',
  doc: {
    version: 1,
    name: 'Ben Test Program',
    goal: 'Get strong',
    startDate: '2000-01-03',
    weeks: 1,
    sessions: [
      {
        date: '2000-01-03',
        title: 'Mon',
        week: 1,
        exercises: [
          { name: 'Squat', sets: 3, reps: '5', intensity: '255 lb' },
          { name: 'Chin-Up', sets: 3, reps: 'AMRAP' },
        ],
      },
      {
        date: '2000-01-05',
        title: 'Wed',
        week: 1,
        exercises: [{ name: 'Squat', sets: 3, reps: '5', intensity: '260 lb' }],
      },
      {
        date: today,
        title: 'Today',
        week: 1,
        exercises: [{ name: 'Squat', sets: 3, reps: '5', intensity: '265 lb' }],
      },
      {
        date: '2999-01-01',
        title: 'Far future',
        week: 2,
        exercises: [{ name: 'Squat', sets: 3, reps: '5', intensity: '270 lb' }],
      },
    ],
  },
})

const andiProgram = {
  id: 'andi-test',
  clientId: 'andi',
  doc: {
    version: 1,
    name: 'Andi Secret Program',
    startDate: '2000-01-01',
    weeks: 1,
    sessions: [
      {
        date: '2000-01-01',
        title: 'Andi day',
        week: 1,
        exercises: [{ name: 'Secret Lift', sets: 1, reps: '1', intensity: '999 lb' }],
      },
    ],
  },
}

const clients = [
  { id: 'ben', name: 'Ben', notes: null, createdAt: '2026-08-01T00:00:00.000Z' },
  { id: 'andi', name: 'Andi', notes: null, createdAt: '2026-08-01T00:00:00.000Z' },
]

const benResolver: Resolver = async () => ({ clientId: 'ben', clientName: 'Ben', email: 'ben@example.com' })
const andiResolver: Resolver = async () => ({ clientId: 'andi', clientName: 'Andi', email: 'andi@example.com' })
const nobodyResolver: Resolver = async () => ({ clientId: 'nobody', clientName: 'Nobody', email: 'n@example.com' })
const anonResolver: Resolver = async () => null

const req = (path: string, method = 'GET') => new Request(`http://localhost${path}`, { method })

beforeAll(() => {
  today = todayPacific()
  dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'coach-fixture-'))
  mkdirSync(join(dir, 'programs'))
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...GIT_ID, ...args], { stdio: 'pipe' })
  git('init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'clients.json'), JSON.stringify(clients, null, 2))
  writeFileSync(join(dir, 'programs', 'ben-test.json'), JSON.stringify(benProgram(today), null, 2))
  writeFileSync(join(dir, 'programs', 'andi-test.json'), JSON.stringify(andiProgram, null, 2))
  git('add', '-A')
  git('commit', '-q', '-m', 'fixture')

  // Uncommitted edits: a draft that must NOT be served.
  const draft = benProgram(today)
  draft.doc.sessions[0].exercises[0].intensity = '111 lb'
  draft.doc.sessions[0].exercises.push({ name: 'Uncommitted Lift', sets: 1, reps: '1', intensity: '123 lb' })
  writeFileSync(join(dir, 'programs', 'ben-test.json'), JSON.stringify(draft, null, 2))
  writeFileSync(join(dir, 'clients.json'), JSON.stringify([...clients, { id: 'draft', name: 'Draft', notes: null, createdAt: '' }], null, 2))

  prevDataDir = process.env.DATA_DIR
  process.env.DATA_DIR = dir
})

afterAll(() => {
  if (prevDataDir === undefined) delete process.env.DATA_DIR
  else process.env.DATA_DIR = prevDataDir
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('committed-only reads', () => {
  test('readCommittedClients reads HEAD, not the working tree', () => {
    const ids = readCommittedClients().map((c) => c.id)
    expect(ids).toEqual(['ben', 'andi'])
  })

  test('readCommittedProgram returns the committed doc, not the uncommitted edit', () => {
    const p = readCommittedProgram('ben')
    expect(p).not.toBeNull()
    expect(p!.programName).toBe('Ben Test Program')
    expect(p!.clientName).toBe('Ben')
    expect(JSON.stringify(p!.doc)).not.toContain('Uncommitted Lift')
    expect(p!.doc.sessions[0].exercises[0].intensity).toBe('255 lb')
  })

  test('unknown client has no program', () => {
    expect(readCommittedProgram('nobody')).toBeNull()
  })

  test('API never serves an uncommitted edit', async () => {
    const res = await handleApi(req('/api/me/program'), benResolver)
    const text = await res!.text()
    expect(text).not.toContain('Uncommitted Lift')
    expect(text).not.toContain('111 lb')
    expect(text).toContain('255 lb')
  })
})

describe('client isolation', () => {
  test('a clientId in the query string is ignored', async () => {
    const res = await handleApi(req('/api/me/program?clientId=andi'), benResolver)
    const text = await res!.text()
    expect(text).not.toContain('Secret Lift')
    expect(text).not.toContain('Andi Secret Program')
    expect(JSON.parse(text).programName).toBe('Ben Test Program')
  })

  test("another client's program never appears in the resolved client's responses", async () => {
    for (const path of ['/api/me', '/api/me/next', '/api/me/program', '/api/me/progress']) {
      const text = await (await handleApi(req(path), benResolver))!.text()
      expect(text).not.toContain('Secret Lift')
      expect(text).not.toContain('Andi Secret Program')
    }
  })

  test('andi resolves to andi data only', async () => {
    const text = await (await handleApi(req('/api/me/progress'), andiResolver))!.text()
    expect(text).toContain('Secret Lift')
    expect(text).not.toContain('Squat')
  })

  test('a resolved client with no committed program gets 404', async () => {
    const res = await handleApi(req('/api/me/next'), nobodyResolver)
    expect(res!.status).toBe(404)
    expect(await res!.json()).toEqual({ error: 'not_found' })
  })
})

describe('handleApi', () => {
  test('unrelated paths return null without resolving', async () => {
    let called = false
    const resolver: Resolver = async () => {
      called = true
      return null
    }
    expect(await handleApi(req('/api/other'), resolver)).toBeNull()
    expect(await handleApi(req('/'), resolver)).toBeNull()
    expect(await handleApi(req('/api/me/unknown'), resolver)).toBeNull()
    expect(called).toBe(false)
  })

  test('401 JSON when unauthenticated, with no-store', async () => {
    const res = await handleApi(req('/api/me'), anonResolver)
    expect(res!.status).toBe(401)
    expect(res!.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await res!.json()).toEqual({ error: 'unauthorized' })
  })

  test('401 on program routes when unauthenticated', async () => {
    for (const path of ['/api/me/next', '/api/me/program', '/api/me/progress']) {
      const res = await handleApi(req(path), anonResolver)
      expect(res!.status).toBe(401)
      expect(await res!.json()).toEqual({ error: 'unauthorized' })
    }
  })

  test('/api/me returns identity', async () => {
    const res = await handleApi(req('/api/me'), benResolver)
    expect(res!.status).toBe(200)
    expect(res!.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await res!.json()).toEqual({ clientId: 'ben', clientName: 'Ben', email: 'ben@example.com' })
  })

  test('/api/me/next returns the session dated today (boundary)', async () => {
    const body = await (await handleApi(req('/api/me/next'), benResolver))!.json()
    expect(body.programName).toBe('Ben Test Program')
    expect(body.session.date).toBe(today)
    expect(body.session.exercises[0].intensity).toBe('265 lb')
    expect(body).not.toHaveProperty('session.status')
  })

  test('/api/me/program annotates status and nextDate', async () => {
    const res = await handleApi(req('/api/me/program'), benResolver)
    expect(res!.headers.get('Cache-Control')).toBe('private, no-store')
    const body = await res!.json()
    expect(body.programName).toBe('Ben Test Program')
    expect(body.goal).toBe('Get strong')
    expect(body.startDate).toBe('2000-01-03')
    expect(body.weeks).toBe(1)
    expect(body.nextDate).toBe(today)
    expect(body.sessions.map((s: { date: string; status: string }) => [s.date, s.status])).toEqual([
      ['2000-01-03', 'done'],
      ['2000-01-05', 'done'],
      [today, 'upcoming'],
      ['2999-01-01', 'upcoming'],
    ])
  })

  test('/api/me/progress: points only for completed sessions, change from first', async () => {
    const body = await (await handleApi(req('/api/me/progress'), benResolver))!.json()
    expect(body.completedWorkouts).toBe(2)
    expect(body.exercises.map((e: { name: string }) => e.name)).toEqual(['Squat'])
    const [squat] = body.exercises
    expect(squat.points).toEqual([
      { date: '2000-01-03', weight: 255 },
      { date: '2000-01-05', weight: 260 },
    ])
    expect(squat.firstWeight).toBe(255)
    expect(squat.currentWeight).toBe(260)
    expect(squat.change).toBe(5)
  })

  test('non-GET on an API route is 405', async () => {
    const res = await handleApi(req('/api/me/next', 'POST'), benResolver)
    expect(res!.status).toBe(405)
  })
})
