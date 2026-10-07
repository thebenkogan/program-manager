// Entry point: serves the API, auth routes, and the built SPA from web/dist.
import path from 'node:path'
import { existsSync } from 'node:fs'
import { handleAuthRoutes } from './auth-routes.ts'
import { handleApi } from './api.ts'
import { getClientId } from './auth.ts'

const DIST = path.resolve(import.meta.dir, '../dist')
const PORT = Number(process.env.PORT ?? 3000)

const SPA_PATHS = /^\/(invite\/[^/]+|signin|program|progress)?\/?$/

async function serveStatic(pathname: string): Promise<Response | null> {
  const file = path.join(DIST, pathname)
  if (pathname !== '/' && !file.startsWith(DIST + path.sep)) return null
  if (pathname !== '/' && existsSync(file) && !(await Bun.file(file).exists()) === false) {
    return new Response(Bun.file(file))
  }
  return null
}

Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  async fetch(request) {
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
  },
})
console.log(`coach-web listening on :${PORT}`)
