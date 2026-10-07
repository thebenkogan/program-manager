// HTTP handler for /api/me/* . Identity comes only from the injected resolver.
import type { MeResponse, NextWorkoutResponse, ProgramResponse, ProgressResponse } from '../shared/api'
import { buildProgress, classifySessions, nextSession, todayPacific } from '../shared/progress'
import { readCommittedProgram } from './programs'

export interface ResolvedClient {
  clientId: string
  clientName: string
  email: string
}

export type Resolver = (req: Request) => Promise<ResolvedClient | null>

const ROUTES = new Set(['/api/me', '/api/me/next', '/api/me/program', '/api/me/progress'])

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  })
}

/** Returns a Response for /api/me/* routes, or null for anything else. */
export async function handleApi(request: Request, resolve: Resolver): Promise<Response | null> {
  const url = new URL(request.url)
  if (!ROUTES.has(url.pathname)) return null

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', Allow: 'GET' },
    })
  }

  const me = await resolve(request)
  if (!me) return json({ error: 'unauthorized' }, 401)

  if (url.pathname === '/api/me') {
    const body: MeResponse = { clientId: me.clientId, clientName: me.clientName, email: me.email }
    return json(body)
  }

  const program = readCommittedProgram(me.clientId)
  if (!program) return json({ error: 'not_found' }, 404)

  const { doc } = program
  const today = todayPacific()

  if (url.pathname === '/api/me/next') {
    const body: NextWorkoutResponse = {
      programName: program.programName,
      session: nextSession(doc.sessions, today),
    }
    return json(body)
  }

  if (url.pathname === '/api/me/program') {
    const sessions = classifySessions(doc.sessions, today)
    const next = nextSession(doc.sessions, today)
    const body: ProgramResponse = {
      programName: program.programName,
      goal: doc.goal,
      notes: doc.notes,
      startDate: doc.startDate,
      weeks: doc.weeks,
      nextDate: next?.date ?? null,
      sessions,
    }
    return json(body)
  }

  const body: ProgressResponse = buildProgress(doc.sessions, today)
  return json(body)
}
