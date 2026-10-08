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
const DATA_DIR = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'coach-hardening-'))
process.env.DATA_DIR = DATA_DIR
writeFileSync(join(DATA_DIR, 'clients.json'), JSON.stringify([{ id: 'ben', name: 'Ben' }]))

const { pool } = await import('./db')
const { migrate } = await import('./migrate')
const { createInvite, inspectInvite } = await import('./invites')
const { handleAuthRoutes } = await import('./auth-routes')
const { getClientId } = await import('./auth')

const EMAIL = 'hardening@example.com'
const PASSWORD = 'first password 1'

function redeemRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/invites/redeem', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

async function redeem(token: string, password: string): Promise<Response> {
  const res = await handleAuthRoutes(redeemRequest({ token, password }))
  if (!res) throw new Error('route not handled')
  return res
}

beforeAll(async () => {
  await migrate()
})

beforeEach(async () => {
  await pool.query('TRUNCATE invites, session, account, verification, "user" CASCADE')
})

afterAll(() => {
  rmSync(DATA_DIR, { recursive: true, force: true })
})

describe('redeem endpoint hardening', () => {
  test('refuses text/plain bodies (cross-site form post)', async () => {
    const { token } = await createInvite('ben', EMAIL)
    const req = new Request('http://localhost:3000/api/invites/redeem', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ token, password: PASSWORD }),
    })
    const res = await handleAuthRoutes(req)
    expect(res?.status).toBe(415)
    expect((await inspectInvite(token)).valid).toBe(true)
  })

  test('refuses a foreign Origin', async () => {
    const { token } = await createInvite('ben', EMAIL)
    const res = await handleAuthRoutes(redeemRequest({ token, password: PASSWORD }, { origin: 'https://evil.example' }))
    expect(res?.status).toBe(403)
    expect((await inspectInvite(token)).valid).toBe(true)
  })

  test('accepts its own Origin', async () => {
    const { token } = await createInvite('ben', EMAIL)
    const res = await handleAuthRoutes(redeemRequest({ token, password: PASSWORD }, { origin: 'http://localhost:3000' }))
    expect(res?.status).toBe(200)
  })

  test('refuses oversized bodies before parsing', async () => {
    const res = await handleAuthRoutes(redeemRequest({ token: 'x', password: 'y'.repeat(20000) }))
    expect(res?.status).toBe(413)
  })

  test('refuses passwords over 128 characters and leaves the invite usable', async () => {
    const { token } = await createInvite('ben', EMAIL)
    const res = await redeem(token, 'p'.repeat(129))
    expect(res.status).toBe(400)
    expect((await inspectInvite(token)).valid).toBe(true)
  })
})

describe('password reset revokes existing sessions', () => {
  test('a session from before the reset no longer resolves', async () => {
    const first = await createInvite('ben', EMAIL)
    const created = await redeem(first.token, PASSWORD)
    expect(created.status).toBe(200)
    const oldCookie = created.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
    const oldReq = new Request('http://localhost:3000/api/me', { headers: { cookie: oldCookie } })
    expect(await getClientId(oldReq)).not.toBeNull()

    const reset = await createInvite('ben', EMAIL)
    const res = await redeem(reset.token, 'second password 2')
    expect(res.status).toBe(200)
    expect(await getClientId(oldReq)).toBeNull()
  })
})
