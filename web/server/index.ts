// Entry point: serves the API, auth routes, and the built SPA from web/dist.
import path from 'node:path'
import { handleAuthRoutes } from './auth-routes.ts'
import { handleApi } from './api.ts'
import { getClientId } from './auth.ts'

const DIST = path.resolve(import.meta.dir, '../dist')
const PORT = Number(process.env.PORT ?? 3000)

const SPA_PATHS = /^\/(invite\/[^/]+|signin|program|progress)?\/?$/

async function serveStatic(pathname: string): Promise<Response | null> {
  if (pathname === '/') return null
  const file = path.join(DIST, pathname)
  if (!file.startsWith(DIST + path.sep)) return null
  const f = Bun.file(file)
  return (await f.exists()) ? new Response(f) : null
}

// Applied to every response the origin sends. Cloudflare passes these through.
const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
}

function withSecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  // Request bodies here are small JSON; anything bigger is refused before it is read.
  maxRequestBodySize: 64 * 1024,
  async fetch(request) {
    return withSecurityHeaders(await route(request))
  },
})

async function route(request: Request): Promise<Response> {
  const url = new URL(request.url)
  try {
    const auth = await handleAuthRoutes(request)
    if (auth) return auth
    const api = await handleApi(request, getClientId)
    if (api) return api
    if (url.pathname.startsWith('/api/')) return Response.json({ error: 'not_found' }, { status: 404 })
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 })
    const asset = await serveStatic(url.pathname)
    if (asset) return asset
    if (SPA_PATHS.test(url.pathname) || url.pathname.startsWith('/invite/')) {
      return new Response(Bun.file(path.join(DIST, 'index.html')), { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
    return new Response('Not found', { status: 404 })
  } catch (err) {
    console.error('request failed', url.pathname, err)
    return Response.json({ error: 'server_error' }, { status: 500 })
  }
}

console.log(`coach-web listening on :${PORT}`)
