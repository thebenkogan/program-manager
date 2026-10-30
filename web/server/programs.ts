// Reads program data from the COMMITTED state of the data repo (git HEAD).
// Uncommitted working-tree edits never reach clients.
import { execFileSync } from 'node:child_process'
import type { Client, ProgramDocument, ProgramFile, Session } from '../../src/shared/types'
import { mergeProgramHistory, type ProgramVersion } from '../shared/history'

export { todayPacific } from '../shared/progress'

export const DEFAULT_DATA_DIR = '/home/benkogan/code/coach/data'

/** Read at call time so tests and deployments can point DATA_DIR elsewhere. */
export function dataDir(): string {
  return process.env.DATA_DIR || DEFAULT_DATA_DIR
}

const GIT_OPTS = {
  encoding: 'utf8' as const,
  stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
  maxBuffer: 32 * 1024 * 1024,
}

/** Contents of a file at a revision (default HEAD), or null if absent. */
function gitShow(path: string, rev = 'HEAD'): string | null {
  try {
    return execFileSync('git', ['-C', dataDir(), 'show', `${rev}:${path}`], GIT_OPTS)
  } catch {
    return null
  }
}

function headSha(): string | null {
  try {
    return execFileSync('git', ['-C', dataDir(), 'rev-parse', 'HEAD'], GIT_OPTS).trim()
  } catch {
    return null
  }
}

/** Program file paths at HEAD, in ls-tree (alphabetical) order. */
function committedProgramPaths(): string[] {
  try {
    const out = execFileSync('git', ['-C', dataDir(), 'ls-tree', '--name-only', 'HEAD', 'programs/'], GIT_OPTS)
    return out
      .split('\n')
      .map((p) => p.trim())
      .filter((p) => p.endsWith('.json'))
  } catch {
    return []
  }
}

export function readCommittedClients(): Client[] {
  const raw = gitShow('clients.json')
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Client[]) : []
  } catch {
    return []
  }
}

export interface CommittedProgram {
  programName: string
  doc: ProgramDocument
  clientName: string
  /** Repo-relative path, e.g. programs/ben-starting-strength.json. */
  path: string
}

/**
 * The committed program whose clientId matches, or null.
 * clientId must come from trusted server-side resolution, never from the request.
 * If a client has several committed programs, the first in path order wins.
 */
export function readCommittedProgram(clientId: string): CommittedProgram | null {
  for (const path of committedProgramPaths()) {
    const raw = gitShow(path)
    if (!raw) continue
    let file: ProgramFile
    try {
      file = JSON.parse(raw) as ProgramFile
    } catch {
      continue
    }
    if (file?.clientId !== clientId || !file.doc || !Array.isArray(file.doc.sessions)) continue
    const client = readCommittedClients().find((c) => c.id === clientId)
    return {
      programName: file.doc.name,
      doc: file.doc,
      clientName: client?.name ?? clientId,
      path,
    }
  }
  return null
}

/** Commit shas that touched one program file, oldest first. */
function programCommits(path: string): string[] {
  try {
    return execFileSync('git', ['-C', dataDir(), 'log', '--reverse', '--format=%H', '--', path], GIT_OPTS)
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

/** Every session ever committed for this program file, one per date. */
function archivedVersions(path: string): ProgramVersion[] {
  const versions: ProgramVersion[] = []
  for (const sha of programCommits(path)) {
    const raw = gitShow(path, sha)
    if (!raw) continue
    let file: ProgramFile
    try {
      file = JSON.parse(raw) as ProgramFile
    } catch {
      continue
    }
    if (Array.isArray(file?.doc?.sessions)) versions.push({ sha, sessions: file.doc.sessions })
  }
  return versions
}

// Rebuilding the archive shells out to git once per commit (about 80 today).
// Cache it per (HEAD, path): a new data commit is a new cache key.
const historyCache = new Map<string, Session[]>()

/**
 * The live program's sessions plus every session from superseded blocks, one
 * per date (the live program wins where dates overlap). Recomputed from the data
 * repo's git history so past blocks keep counting after they are replaced.
 */
export function readSessionHistory(program: CommittedProgram): Session[] {
  const head = headSha()
  if (!head) return program.doc.sessions
  const key = `${head}:${program.path}`
  let archived = historyCache.get(key)
  if (!archived) {
    archived = mergeProgramHistory(archivedVersions(program.path), [])
    historyCache.clear()
    historyCache.set(key, archived)
  }
  return mergeProgramHistory([{ sha: head, sessions: archived }], program.doc.sessions)
}
