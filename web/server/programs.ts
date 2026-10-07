// Reads program data from the COMMITTED state of the data repo (git HEAD).
// Uncommitted working-tree edits never reach clients.
import { execFileSync } from 'node:child_process'
import type { Client, ProgramDocument, ProgramFile } from '../../src/shared/types'

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

/** Contents of a file at HEAD, or null if it does not exist or git fails. */
function gitShow(path: string): string | null {
  try {
    return execFileSync('git', ['-C', dataDir(), 'show', `HEAD:${path}`], GIT_OPTS)
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
    }
  }
  return null
}
