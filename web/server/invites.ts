// Invite links: single-use, 7-day, stored as sha256 hashes only.
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pool } from './db'

export interface ClientRecord {
  id: string
  name: string
}

/** Reads the working-tree client list on every call so new clients are picked up without a restart. */
export function readClients(): ClientRecord[] {
  const dataDir = process.env.DATA_DIR ?? '/home/benkogan/code/coach/data'
  const raw = JSON.parse(readFileSync(join(dataDir, 'clients.json'), 'utf8')) as unknown
  if (!Array.isArray(raw)) throw new Error('clients.json must be an array')
  return raw.filter(
    (c): c is ClientRecord =>
      typeof c === 'object' && c !== null && typeof (c as ClientRecord).id === 'string' && typeof (c as ClientRecord).name === 'string',
  )
}

export function findClient(clientId: string): ClientRecord | null {
  return readClients().find((c) => c.id === clientId) ?? null
}


export const MIN_PASSWORD_LENGTH = 8

export interface CreatedInvite {
  token: string
  url: string
  expiresAt: Date
}

export type InviteInspection =
  | { valid: true; email: string; clientName: string; expiresAt: Date }
  | { valid: false }

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function normalizeEmail(email: string): string {
  const e = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error(`Invalid email: ${email}`)
  return e
}

/** Creates a single-use invite for an existing client. Refuses client ids not in clients.json. */
export async function createInvite(clientId: string, email: string): Promise<CreatedInvite> {
  if (!findClient(clientId)) throw new Error(`Unknown client id: ${clientId}`)
  const baseUrl = process.env.BETTER_AUTH_URL
  if (!baseUrl) throw new Error('BETTER_AUTH_URL is not set')

  const normalized = normalizeEmail(email)
  const token = randomBytes(32).toString('base64url')
  const { rows } = await pool.query<{ expires_at: Date }>(
    `INSERT INTO invites (id, token_hash, client_id, email, created_at, expires_at)
     VALUES ($1, $2, $3, $4, now(), now() + interval '7 days')
     RETURNING expires_at`,
    [randomUUID(), hashToken(token), clientId, normalized],
  )
  const expiresAt = rows[0].expires_at
  return { token, url: `${baseUrl.replace(/\/$/, '')}/invite/${token}`, expiresAt }
}

/** Public, read-only check used by the invite page. Never returns the token or hash. */
export async function inspectInvite(token: string): Promise<InviteInspection> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 256) return { valid: false }
  const { rows } = await pool.query<{ email: string; client_id: string; expires_at: Date }>(
    `SELECT email, client_id, expires_at FROM invites
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [hashToken(token)],
  )
  const row = rows[0]
  if (!row) return { valid: false }
  const client = findClient(row.client_id)
  if (!client) return { valid: false }
  return { valid: true, email: row.email, clientName: client.name, expiresAt: row.expires_at }
}

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status })
}

function withCookiesFrom(source: Response, body: unknown): Response {
  const headers = new Headers({ 'content-type': 'application/json' })
  for (const cookie of source.headers.getSetCookie()) headers.append('set-cookie', cookie)
  return new Response(JSON.stringify(body), { status: 200, headers })
}

/**
 * Redeems an invite and signs the client in.
 * - No account for the invite email: creates one bound to the invite's clientId.
 * - Existing account for the email: sets the new password, refused unless the account has the same clientId.
 * The invite is claimed atomically before any account change, and released again if the redemption fails.
 */
export async function redeemInvite(token: string, password: string, request: Request): Promise<Response> {
  if (typeof token !== 'string' || typeof password !== 'string') return jsonError(400, 'Invalid request')
  if (password.length < MIN_PASSWORD_LENGTH) {
    return jsonError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }

  const claim = await pool.query<{ id: string; client_id: string; email: string }>(
    `UPDATE invites SET used_at = now()
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
     RETURNING id, client_id, email`,
    [hashToken(token)],
  )
  const invite = claim.rows[0]
  if (!invite) return jsonError(400, 'Invite is invalid, expired, or already used')

  const release = () => pool.query(`UPDATE invites SET used_at = NULL WHERE id = $1`, [invite.id])

  try {
    const client = findClient(invite.client_id)
    if (!client) {
      await release()
      return jsonError(400, 'Invite is invalid, expired, or already used')
    }

    // Loaded lazily so the invite CLI (createInvite only) does not boot Better Auth.
    const { auth } = await import('./auth')
    const ctx = await auth.$context
    const existing = await ctx.internalAdapter.findUserByEmail(invite.email)

    if (existing) {
      const user = existing.user as { id: string; clientId?: unknown }
      if (user.clientId !== invite.client_id) {
        await release()
        return jsonError(403, 'This invite cannot be used for this account')
      }
      const hash = await hashPassword(password)
      const accounts = await ctx.internalAdapter.findAccounts(user.id)
      const hasCredential = accounts.some((a) => a.providerId === 'credential')
      if (hasCredential) {
        await ctx.internalAdapter.updatePassword(user.id, hash)
      } else {
        await ctx.internalAdapter.linkAccount({
          userId: user.id,
          providerId: 'credential',
          accountId: user.id,
          password: hash,
        })
      }
      const signIn = await auth.api.signInEmail({
        body: { email: invite.email, password },
        headers: request.headers,
        asResponse: true,
      })
      if (!signIn.ok) {
        await release()
        return jsonError(500, 'Could not sign in')
      }
      return withCookiesFrom(signIn, { ok: true, clientId: invite.client_id, email: invite.email })
    }

    const signUp = await auth.api.signUpEmail({
      body: {
        email: invite.email,
        password,
        name: client.name,
        clientId: invite.client_id,
      },
      headers: request.headers,
      asResponse: true,
    })
    if (!signUp.ok) {
      await release()
      return jsonError(400, 'Could not create account')
    }
    return withCookiesFrom(signUp, { ok: true, clientId: invite.client_id, email: invite.email })
  } catch (err) {
    await release()
    throw err
  }
}
