import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Needs a disposable Postgres database. Refuses anything whose name does not contain "test".
const TEST_DB = process.env.TEST_DATABASE_URL
if (!TEST_DB || !/test/i.test(new URL(TEST_DB).pathname)) {
  throw new Error('Set TEST_DATABASE_URL to a disposable database whose name contains "test"')
}
process.env.DATABASE_URL = TEST_DB
process.env.BETTER_AUTH_URL = 'http://localhost:3000'
process.env.BETTER_AUTH_SECRET ??= 'test-secret-test-secret-test-secret-123456'
const DATA_DIR = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'coach-clients-'))
process.env.DATA_DIR = DATA_DIR
writeFileSync(join(DATA_DIR, 'clients.json'), JSON.stringify([{ id: 'ben', name: 'Ben' }, { id: 'andi', name: 'Andi' }]))

const { auth, getClientId } = await import('./auth')
const { pool } = await import('./db')
const { migrate } = await import('./migrate')
const { createInvite, redeemInvite } = await import('./invites')
const { handleAuthRoutes } = await import('./auth-routes')

const ORIGIN = 'http://localhost:3000'
const EMAIL = 'ben-auth@example.com'
const PASSWORD = 'correct horse battery'

function cookieHeader(res: Response): string {
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  })
}

async function resetDb() {
  await pool.query('TRUNCATE invites, session, account, verification, "user" CASCADE')
}

async function signedInRequest(email: string, password: string): Promise<Request> {
  const res = await auth.api.signInEmail({ body: { email, password }, asResponse: true })
  return new Request(`${ORIGIN}/`, { headers: { cookie: cookieHeader(res) } })
}

beforeAll(async () => {
  await migrate()
})

beforeEach(async () => {
  await resetDb()
})

// The pool is shared across test files in this process, so it is left open.
afterAll(() => {
  rmSync(DATA_DIR, { recursive: true, force: true })
})

describe('getClientId', () => {
  test('returns null without a session cookie', async () => {
    expect(await getClientId(new Request(`${ORIGIN}/`))).toBeNull()
  })

  test('returns null for a forged session cookie', async () => {
    const req = new Request(`${ORIGIN}/`, { headers: { cookie: 'better-auth.session_token=forged.signature' } })
    expect(await getClientId(req)).toBeNull()
  })

  test('resolves a redeemed session to its client', async () => {
    const { token } = await createInvite('ben', EMAIL)
    const res = await redeemInvite(token, PASSWORD, new Request(`${ORIGIN}/api/invites/redeem`, { method: 'POST' }))
    expect(res.status).toBe(200)
    const who = await getClientId(new Request(`${ORIGIN}/`, { headers: { cookie: cookieHeader(res) } }))
    expect(who).toEqual({ clientId: 'ben', clientName: 'Ben', email: EMAIL })
  })
})

describe('auth surface', () => {
  test('public sign-up is refused at the HTTP layer', async () => {
    const res = await handleAuthRoutes(post('/api/auth/sign-up/email', { email: 'x@example.com', password: PASSWORD, name: 'x', clientId: 'ben' }))
    expect(res?.status).toBe(404)
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM "user"')
    expect(rows[0].n).toBe(0)
  })

  test('password reset and verification endpoints are not exposed', async () => {
    for (const path of ['/api/auth/request-password-reset', '/api/auth/forget-password', '/api/auth/send-verification-email', '/api/auth/sign-in/social']) {
      const res = await handleAuthRoutes(post(path, { email: EMAIL }))
      expect(res?.status).toBe(404)
    }
  })

  test('sign-in with email and password works after redemption; wrong password rejected', async () => {
    const { token } = await createInvite('ben', EMAIL)
    await redeemInvite(token, PASSWORD, new Request(ORIGIN))
    const ok = await handleAuthRoutes(post('/api/auth/sign-in/email', { email: EMAIL, password: PASSWORD }))
    expect(ok?.status).toBe(200)
    const bad = await handleAuthRoutes(post('/api/auth/sign-in/email', { email: EMAIL, password: 'wrong password 123' }))
    expect(bad?.status).toBe(401)
  })

  test('sign-out clears the session', async () => {
    const { token } = await createInvite('ben', EMAIL)
    const redeemed = await redeemInvite(token, PASSWORD, new Request(ORIGIN))
    const cookie = cookieHeader(redeemed)
    const out = await handleAuthRoutes(new Request(`${ORIGIN}/api/auth/sign-out`, { method: 'POST', headers: { cookie, origin: ORIGIN } }))
    expect(out?.status).toBe(200)
    // Re-presenting the old cookie must not resolve to a client.
    expect(await getClientId(new Request(`${ORIGIN}/`, { headers: { cookie } }))).toBeNull()
  })

  test('user rows carry clientId from the invite', async () => {
    const { token } = await createInvite('andi', EMAIL)
    await redeemInvite(token, PASSWORD, new Request(ORIGIN))
    const { rows } = await pool.query('SELECT "clientId" FROM "user" WHERE email = $1', [EMAIL])
    expect(rows[0].clientId).toBe('andi')
  })

  test('signed-in request from an unknown client resolves to null', async () => {
    const { token } = await createInvite('ben', EMAIL)
    await redeemInvite(token, PASSWORD, new Request(ORIGIN))
    await pool.query(`UPDATE "user" SET "clientId" = 'ghost' WHERE email = $1`, [EMAIL])
    expect(await getClientId(await signedInRequest(EMAIL, PASSWORD))).toBeNull()
  })
})
