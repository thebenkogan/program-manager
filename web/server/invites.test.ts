import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

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

const { auth } = await import('./auth')
const { pool } = await import('./db')
const { migrate } = await import('./migrate')
const { createInvite, inspectInvite, redeemInvite, hashToken } = await import('./invites')
const { handleAuthRoutes } = await import('./auth-routes')

const ORIGIN = 'http://localhost:3000'
const EMAIL = 'ben-invite@example.com'
const PASSWORD = 'first password 1'
const REQ = () => new Request(`${ORIGIN}/api/invites/redeem`, { method: 'POST' })

function cookieHeader(res: Response): string {
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
}

async function resetDb() {
  await pool.query('TRUNCATE invites, session, account, verification, "user" CASCADE')
}

async function canSignIn(email: string, password: string): Promise<boolean> {
  try {
    await auth.api.signInEmail({ body: { email, password } })
    return true
  } catch {
    return false
  }
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

describe('migrate', () => {
  test('is idempotent', async () => {
    await migrate()
    await migrate()
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'invites'`)
    expect(rows[0].n).toBe(1)
  })
})

describe('createInvite', () => {
  test('refuses unknown client ids', async () => {
    await expect(createInvite('nobody', EMAIL)).rejects.toThrow(/Unknown client/)
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM invites')
    expect(rows[0].n).toBe(0)
  })

  test('returns a url under BETTER_AUTH_URL and an expiry 7 days out', async () => {
    const before = Date.now()
    const invite = await createInvite('ben', EMAIL)
    expect(invite.url).toBe(`${ORIGIN}/invite/${invite.token}`)
    const delta = invite.expiresAt.getTime() - before
    expect(delta).toBeGreaterThan(7 * 24 * 3600 * 1000 - 60_000)
    expect(delta).toBeLessThan(7 * 24 * 3600 * 1000 + 60_000)
    expect(invite.token.length).toBe(43) // 32 random bytes, base64url, no padding
  })

  test('stores only the sha256 hash of the token, never the token itself', async () => {
    const { token } = await createInvite('ben', EMAIL)
    const { rows } = await pool.query<{ token_hash: string }>('SELECT token_hash FROM invites')
    expect(rows).toHaveLength(1)
    expect(rows[0].token_hash).toBe(createHash('sha256').update(token).digest('hex'))
    expect(rows[0].token_hash).toBe(hashToken(token))
    const dump = await pool.query('SELECT row_to_json(i)::text AS j FROM invites i')
    expect(dump.rows[0].j.includes(token)).toBe(false)
  })
})

describe('redeemInvite', () => {
  test('single use: the second redemption fails', async () => {
    const { token } = await createInvite('ben', EMAIL)
    const first = await redeemInvite(token, PASSWORD, REQ())
    expect(first.status).toBe(200)
    const second = await redeemInvite(token, PASSWORD, REQ())
    expect(second.status).toBe(400)
  })

  test('concurrent redemptions: exactly one succeeds', async () => {
    const { token } = await createInvite('ben', EMAIL)
    const results = await Promise.all([1, 2, 3, 4].map(() => redeemInvite(token, PASSWORD, REQ())))
    expect(results.map((r) => r.status).filter((s) => s === 200)).toHaveLength(1)
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM "user" WHERE email = $1', [EMAIL])
    expect(rows[0].n).toBe(1)
  })

  test('expired invite is rejected and inspect says invalid', async () => {
    const { token } = await createInvite('ben', EMAIL)
    await pool.query(`UPDATE invites SET expires_at = now() - interval '1 second'`)
    expect((await inspectInvite(token)).valid).toBe(false)
    const res = await redeemInvite(token, PASSWORD, REQ())
    expect(res.status).toBe(400)
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM "user"')
    expect(rows[0].n).toBe(0)
  })

  test('wrong and unknown tokens are rejected', async () => {
    await createInvite('ben', EMAIL)
    expect((await redeemInvite('not-a-real-token', PASSWORD, REQ())).status).toBe(400)
    expect((await redeemInvite('', PASSWORD, REQ())).status).toBe(400)
    expect(await inspectInvite('not-a-real-token')).toEqual({ valid: false })
  })

  test('password under 8 characters is rejected and the invite stays usable', async () => {
    const { token } = await createInvite('ben', EMAIL)
    const short = await redeemInvite(token, 'short77', REQ())
    expect(short.status).toBe(400)
    expect((await inspectInvite(token)).valid).toBe(true)
    const ok = await redeemInvite(token, 'exactly8', REQ())
    expect(ok.status).toBe(200)
  })

  test('a successful redemption sets a session cookie', async () => {
    const { token } = await createInvite('ben', EMAIL)
    const res = await redeemInvite(token, PASSWORD, REQ())
    expect(res.headers.getSetCookie().some((c) => c.includes('session_token='))).toBe(true)
    expect(await res.json()).toEqual({ ok: true, clientId: 'ben', email: EMAIL })
  })

  test('password reset: a new invite for an existing account sets the new password and signs in', async () => {
    const first = await createInvite('ben', EMAIL)
    await redeemInvite(first.token, PASSWORD, REQ())

    const reset = await createInvite('ben', EMAIL)
    const res = await redeemInvite(reset.token, 'brand new password', REQ())
    expect(res.status).toBe(200)
    expect(res.headers.getSetCookie().some((c) => c.includes('session_token='))).toBe(true)

    expect(await canSignIn(EMAIL, 'brand new password')).toBe(true)
    expect(await canSignIn(EMAIL, PASSWORD)).toBe(false)
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM "user" WHERE email = $1', [EMAIL])
    expect(rows[0].n).toBe(1)
  })

  test('password reset refused when the account belongs to a different client; old password kept', async () => {
    const first = await createInvite('ben', EMAIL)
    await redeemInvite(first.token, PASSWORD, REQ())

    const wrongClient = await createInvite('andi', EMAIL)
    const res = await redeemInvite(wrongClient.token, 'attempted new pw', REQ())
    expect(res.status).toBe(403)
    expect(res.headers.getSetCookie()).toHaveLength(0)
    expect(await canSignIn(EMAIL, PASSWORD)).toBe(true)
    expect(await canSignIn(EMAIL, 'attempted new pw')).toBe(false)
    // The refused invite is released, not burned.
    expect((await inspectInvite(wrongClient.token)).valid).toBe(true)
  })
})

describe('invite HTTP routes', () => {
  test('GET /api/invites/:token returns inspection JSON without the token or its hash', async () => {
    const { token } = await createInvite('ben', EMAIL)
    const res = await handleAuthRoutes(new Request(`${ORIGIN}/api/invites/${token}`))
    expect(res?.status).toBe(200)
    const body = await res!.json()
    expect(body).toMatchObject({ valid: true, email: EMAIL, clientName: 'Ben' })
    const text = JSON.stringify(body)
    expect(text.includes(token)).toBe(false)
    expect(text.includes(hashToken(token))).toBe(false)
  })

  test('GET for an unknown token reports invalid', async () => {
    const res = await handleAuthRoutes(new Request(`${ORIGIN}/api/invites/nope`))
    expect(await res!.json()).toEqual({ valid: false })
  })

  test('POST /api/invites/redeem sets the session cookie and rejects bad bodies', async () => {
    const { token } = await createInvite('ben', EMAIL)
    const bad = await handleAuthRoutes(new Request(`${ORIGIN}/api/invites/redeem`, { method: 'POST', body: '{"token":1}', headers: { 'content-type': 'application/json' } }))
    expect(bad?.status).toBe(400)
    const res = await handleAuthRoutes(
      new Request(`${ORIGIN}/api/invites/redeem`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password: PASSWORD }),
      }),
    )
    expect(res?.status).toBe(200)
    expect(cookieHeader(res!)).toContain('session_token=')
  })

  test('unrelated paths return null', async () => {
    expect(await handleAuthRoutes(new Request(`${ORIGIN}/api/me`))).toBeNull()
    expect(await handleAuthRoutes(new Request(`${ORIGIN}/`))).toBeNull()
  })
})
