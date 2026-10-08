// HTTP routes for auth and invites. Returns null for paths it does not own.
import { auth } from './auth'
import { inspectInvite, redeemInvite } from './invites'

// Only these Better Auth endpoints are exposed. Everything else under /api/auth (sign-up, password reset,
// email verification, social sign-in) is refused so accounts can only be created from an invite.
const AUTH_ALLOWLIST = new Set([
  'POST /api/auth/sign-in/email',
  'POST /api/auth/sign-out',
  'GET /api/auth/get-session',
])

const INVITE_PATH = /^\/api\/invites\/([^/]+)$/
const MAX_BODY_BYTES = 8 * 1024

/** Browsers can send a cross-site form as text/plain without a preflight. Requiring JSON blocks that. */
function isJsonRequest(request: Request): boolean {
  const type = request.headers.get('content-type') ?? ''
  return type.split(';')[0].trim().toLowerCase() === 'application/json'
}

/** A browser always sends Origin on cross-site POSTs. Reject any origin other than our own. */
function originAllowed(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true
  const own = process.env.BETTER_AUTH_URL
  return own !== undefined && origin === new URL(own).origin
}

function json(status: number, body: unknown): Response {
  return Response.json(body, { status })
}

export async function handleAuthRoutes(request: Request): Promise<Response | null> {
  const url = new URL(request.url)
  const { pathname } = url
  const method = request.method.toUpperCase()

  if (pathname === '/api/auth' || pathname.startsWith('/api/auth/')) {
    if (!AUTH_ALLOWLIST.has(`${method} ${pathname}`)) return json(404, { error: 'Not found' })
    return auth.handler(request)
  }

  if (pathname === '/api/invites/redeem') {
    if (method !== 'POST') return json(405, { error: 'Method not allowed' })
    if (!originAllowed(request)) return json(403, { error: 'Forbidden' })
    if (!isJsonRequest(request)) return json(415, { error: 'Content-Type must be application/json' })
    const raw = await request.text()
    if (raw.length > MAX_BODY_BYTES) return json(413, { error: 'Request too large' })
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      return json(400, { error: 'Invalid JSON' })
    }
    const { token, password } = (body ?? {}) as { token?: unknown; password?: unknown }
    if (typeof token !== 'string' || typeof password !== 'string') {
      return json(400, { error: 'token and password are required' })
    }
    return redeemInvite(token, password, request)
  }

  const match = INVITE_PATH.exec(pathname)
  if (match) {
    if (method !== 'GET') return json(405, { error: 'Method not allowed' })
    let token: string
    try {
      token = decodeURIComponent(match[1])
    } catch {
      return json(200, { valid: false })
    }
    const result = await inspectInvite(token)
    if (result.valid) {
      return json(200, {
        valid: true,
        email: result.email,
        clientName: result.clientName,
        expiresAt: result.expiresAt.toISOString(),
      })
    }
    return json(200, { valid: false })
  }

  return null
}
