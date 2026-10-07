// Better Auth instance: email + password only, no verification, no reset, no social providers.
// Public sign-up is blocked at the HTTP layer (see auth-routes.ts); accounts are created only by redeemInvite.
import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { pool } from './db'
import { findClient } from './invites'

export const authOptions = {
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: pool,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    requireEmailVerification: false,
  },
  user: {
    additionalFields: {
      // Required on user. Set only server-side from a redeemed invite; input stays enabled because
      // the public sign-up route is blocked in auth-routes.ts, not by withholding the field.
      clientId: { type: 'string', required: true, input: true },
    },
  },
} satisfies BetterAuthOptions

export const auth = betterAuth(authOptions)

export interface ClientSession {
  clientId: string
  clientName: string
  email: string
}

/** Resolves the request's session cookie to a client. Returns null when signed out or the client is unknown. */
export async function getClientId(request: Request): Promise<ClientSession | null> {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return null
  const clientId = (session.user as { clientId?: unknown }).clientId
  if (typeof clientId !== 'string') return null
  const client = findClient(clientId)
  if (!client) return null
  return { clientId, clientName: client.name, email: session.user.email }
}
