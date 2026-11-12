// Entry point: serves the API, auth routes, and the built SPA from web/dist.
import path from 'node:path'
import { handleAuthRoutes } from './auth-routes.ts'
import { handleApi } from './api.ts'
import { handleVideoRoutes } from './videos.ts'
import { handleUploadRoutes } from './uploads.ts'
import { resumePending } from './transcode.ts'
import { getClientId } from './auth.ts'

const DIST = path.resolve(import.meta.dir, '../dist')
const PORT = Number(process.env.PORT ?? 3000)

const SPA_PATHS = /^\/(invite\/[^/]+|signin|program|progress|videos|label|upload)?\/?$/

// A year is only safe for content-hashed filenames: the name changes when the
// bytes do, so a cached copy can never be wrong.
const IMMUTABLE = 'public, max-age=31536000, immutable'
// HTML is the one file that must never be reused blind: a stale index.html pins
// the whole SPA to the old bundle for as long as its freshness lasts (Cloudflare
// fills in max-age=14400 where the origin is silent), and an open tab that never
// re-reads it keeps running that bundle indefinitely.
const REVALIDATE = 'no-cache'

function cacheControl(pathname: string): string {
  return pathname.startsWith('/assets/') ? IMMUTABLE : REVALIDATE
}

/** ETag from size + mtime: cheap, and changes whenever the file on disk does. */
function etagFor(file: ReturnType<typeof Bun.file>): string {
  return `W/"${file.size}-${Math.floor(file.lastModified)}"`
}

/** The entry bundle the server is currently serving — i.e. this deployment's build id. */
let appVersion: string | null | undefined
async function version(): Promise<string | null> {
  if (appVersion !== undefined) return appVersion
  try {
    const html = await Bun.file(path.join(DIST, 'index.html')).text()
    appVersion = /assets\/(index-[^"']+\.js)/.exec(html)?.[1] ?? null
  } catch {
    appVersion = null
  }
  return appVersion
}

async function serveStatic(request: Request, pathname: string): Promise<Response | null> {
  if (pathname === '/') return null
  const file = path.join(DIST, pathname)
  if (!file.startsWith(DIST + path.sep)) return null
  const f = Bun.file(file)
  if (!(await f.exists())) return null
  const headers = new Headers({ 'cache-control': cacheControl(pathname) })
  const etag = etagFor(f)
  headers.set('etag', etag)
  // Revalidation is the point of `no-cache`; answer it with an empty 304 rather
  // than re-sending the file.
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })
  return new Response(f, { headers })
}

/** The SPA shell: always revalidated, so a deploy is picked up on the next load. */
async function htmlResponse(request: Request, file: string): Promise<Response> {
  const f = Bun.file(file)
  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8', 'cache-control': REVALIDATE })
  const etag = etagFor(f)
  headers.set('etag', etag)
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })
  return new Response(f, { headers })
}

// Applied to every response the origin sends. Cloudflare passes these through.
const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "media-src 'self'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
}

function withSecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

// Finish any upload that was mid-transcode when the container last stopped.
resumePending()

Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  // JSON bodies are small, but upload chunks are 8 MB. Upload routes enforce their
  // own chunk cap; everything else rejects oversized bodies before parsing.
  maxRequestBodySize: 12 * 1024 * 1024,
  async fetch(request) {
    return withSecurityHeaders(await route(request))
  },
})

async function route(request: Request): Promise<Response> {
  const url = new URL(request.url)
  try {
    // Public and unauthenticated: it is only a build id, and the sign-in page
    // needs it too.
    if (url.pathname === '/api/version') {
      return Response.json({ version: await version() }, { headers: { 'cache-control': 'no-store' } })
    }
    const auth = await handleAuthRoutes(request)
    if (auth) return auth
    const api = await handleApi(request, getClientId)
    if (api) return api
    const uploads = await handleUploadRoutes(request, getClientId)
    if (uploads) return uploads
    const videos = await handleVideoRoutes(request, getClientId)
    if (videos) return videos
    if (url.pathname.startsWith('/api/')) return Response.json({ error: 'not_found' }, { status: 404 })
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 })
    const asset = await serveStatic(request, url.pathname)
    if (asset) return asset
    if (SPA_PATHS.test(url.pathname) || url.pathname.startsWith('/invite/')) {
      return htmlResponse(request, path.join(DIST, 'index.html'))
    }
    return new Response('Not found', { status: 404 })
  } catch (err) {
    console.error('request failed', url.pathname, err)
    return Response.json({ error: 'server_error' }, { status: 500 })
  }
}

console.log(`coach-web listening on :${PORT}`)
