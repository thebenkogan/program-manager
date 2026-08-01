import type { Plugin, ViteDevServer } from 'vite'
import { loadEnv } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ProgramDocument, ProgramFile, SyncState } from '../shared/types.ts'
import { validateProgram } from '../shared/validate.ts'
import { docHash } from './hash.ts'
import {
  getProgramFile,
  getSyncState,
  listClients,
  listProgramFiles,
  programRelPath,
  writeSyncState,
  deleteProgramData,
  ROOT,
} from './store.ts'
import {
  dataFileStatus,
  programDiff,
  commitFile,
  discardFile,
  deleteTrackedProgram,
  programHistory,
  programDocAtRef,
} from './git.ts'

type SsrLoader = (id: string) => Promise<unknown>

interface ProgramSummary extends ProgramFile {
  docHash: string
  errors: string[]
  valid: boolean
  hasPendingDiff: boolean
  pendingStats: { added: number; removed: number } | null
  committedDoc: ProgramDocument | null
  syncStatus: 'none' | 'synced' | 'changed'
  sync: SyncState | null
}

function send(res: ServerResponse, code: number, payload: unknown) {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (c: Buffer) => (body += c))
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

function programSummary(env: ProgramFile): ProgramSummary {
  const sync = getSyncState(env.id)
  const currentHash = docHash(env.doc)
  const errors = validateProgram(env.doc)
  const diff = programDiff(env.id)
  let syncStatus: 'none' | 'synced' | 'changed'
  if (!sync) syncStatus = 'none'
  else if (diff !== null) syncStatus = 'synced'
  else syncStatus = sync.syncedHash === currentHash ? 'synced' : 'changed'
  return {
    ...env,
    docHash: currentHash,
    errors,
    valid: errors.length === 0,
    hasPendingDiff: diff !== null,
    pendingStats: diff?.stats ?? null,
    committedDoc: diff !== null ? programDocAtRef(programRelPath(env.id), 'HEAD') : null,
    syncStatus,
    sync,
  }
}

function getSsrLoader(server: ViteDevServer): SsrLoader | null {
  const s = server as ViteDevServer & { ssr?: { loadModule: (id: string) => Promise<unknown> } }
  if (typeof s.ssrLoadModule === 'function') return (id) => s.ssrLoadModule(id)
  const ssr = s.ssr
  if (ssr?.loadModule) return (id) => ssr.loadModule(id)
  return null
}

export function coachData(): Plugin {
  let ssrLoader: SsrLoader | null = null

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = (req.url ?? '').split('?')[0]
    const m = (re: RegExp) => url.match(re)

    try {
      if (req.method === 'GET' && url === '/__data') {
        return send(res, 200, {
          clients: listClients(),
          programs: listProgramFiles().map(programSummary),
          pendingFiles: dataFileStatus(),
        })
      }

      const diffM = m(/^\/__program\/([^/]+)\/diff$/)
      if (req.method === 'GET' && diffM) {
        const id = diffM[1]
        const rel = programRelPath(id)
        return send(res, 200, {
          id,
          oldDoc: programDocAtRef(rel, 'HEAD'),
          newDoc: getProgramFile(id)?.doc ?? null,
        })
      }

      const historyM = m(/^\/__program\/([^/]+)\/history$/)
      if (req.method === 'GET' && historyM) {
        return send(res, 200, { id: historyM[1], versions: programHistory(historyM[1]) })
      }

      const versionM = m(/^\/__program\/([^/]+)\/version\/([0-9a-f]+)$/)
      if (req.method === 'GET' && versionM) {
        const id = versionM[1]
        const hash = versionM[2]
        const rel = programRelPath(id)
        return send(res, 200, {
          id,
          hash,
          oldDoc: programDocAtRef(rel, `${hash}^`),
          newDoc: programDocAtRef(rel, hash),
        })
      }

      const applyM = m(/^\/__program\/([^/]+)\/apply$/)
      if (req.method === 'POST' && applyM) {
        const id = applyM[1]
        const env = getProgramFile(id)
        if (!env) return send(res, 404, { error: 'Program not found' })
        const body = await readBody(req)
        const message =
          typeof body.message === 'string' && body.message.trim()
            ? body.message.trim()
            : `Update program ${env.doc.name}`
        const version = commitFile(programRelPath(id), message)
        return send(res, 200, { id, version })
      }

      const discardM = m(/^\/__program\/([^/]+)\/discard$/)
      if (req.method === 'POST' && discardM) {
        const id = discardM[1]
        discardFile(programRelPath(id))
        return send(res, 200, { id })
      }

      const deleteM = m(/^\/__program\/([^/]+)\/delete$/)
      if (req.method === 'POST' && deleteM) {
        const id = deleteM[1]
        const env = getProgramFile(id)
        const sync = getSyncState(id)
        if (sync?.calendarId) {
          const cal = await loadCalendar()
          await cal.deleteCalendar(sync.calendarId)
        }
        deleteProgramData(id)
        deleteTrackedProgram(programRelPath(id), `Delete program ${env?.doc.name ?? id}`)
        return send(res, 200, { id })
      }

      const syncM = m(/^\/__sync\/([^/]+)$/)
      if (req.method === 'POST' && syncM) {
        const id = syncM[1]
        const env = getProgramFile(id)
        if (!env) return send(res, 404, { error: 'Program not found' })
        const errs = validateProgram(env.doc)
        if (errs.length > 0) return send(res, 400, { error: `Invalid program: ${errs.join('; ')}` })
        if (getSyncState(id)) return send(res, 400, { error: 'Already synced — use Resync.' })
        const cal = await loadCalendar()
        const state = await cal.syncProgram(env.doc)
        writeSyncState(id, state)
        return send(res, 200, programSummary(getProgramFile(id)!))
      }

      const resyncM = m(/^\/__resync\/([^/]+)$/)
      if (req.method === 'POST' && resyncM) {
        const id = resyncM[1]
        const env = getProgramFile(id)
        if (!env) return send(res, 404, { error: 'Program not found' })
        const errs = validateProgram(env.doc)
        if (errs.length > 0) return send(res, 400, { error: `Invalid program: ${errs.join('; ')}` })
        if (programDiff(id)) return send(res, 400, { error: 'Commit the proposed changes before resyncing.' })
        const cal = await loadCalendar()
        const state = await cal.resyncProgram(env.doc, getSyncState(id))
        writeSyncState(id, state)
        return send(res, 200, programSummary(getProgramFile(id)!))
      }

      return send(res, 404, { error: 'Not found' })
    } catch (e) {
      return send(res, 500, { error: e instanceof Error ? e.message : String(e) })
    }
  }

  async function loadCalendar(): Promise<typeof import('./calendar.ts')> {
    if (!ssrLoader) throw new Error('Calendar backend unavailable')
    return (await ssrLoader('/src/server/calendar.ts')) as typeof import('./calendar.ts')
  }

  return {
    name: 'coach-data',
    configureServer(server) {
      const env = loadEnv(server.config.mode, ROOT, '')
      for (const [k, v] of Object.entries(env)) {
        if (process.env[k] === undefined) process.env[k] = v
      }
      ssrLoader = getSsrLoader(server)
      if (!ssrLoader) {
        server.config.logger.warn('[coach] SSR module loader unavailable — calendar sync disabled')
      }
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/__')) void handle(req, res)
        else next()
      })
    },
  }
}
