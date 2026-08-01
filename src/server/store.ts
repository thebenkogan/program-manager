import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Client, ProgramFile, SyncState } from '../shared/types.ts'

export const ROOT = path.resolve(process.cwd())
export const DATA_DIR = path.join(ROOT, 'data')
export const PROGRAMS_DIR = path.join(DATA_DIR, 'programs')
export const SYNC_DIR = path.join(DATA_DIR, 'state', 'sync')

function ensureDirs() {
  mkdirSync(PROGRAMS_DIR, { recursive: true })
  mkdirSync(SYNC_DIR, { recursive: true })
}

export function programRelPath(id: string): string {
  return `data/programs/${id}.json`
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as T
  } catch {
    return null
  }
}

function writeJson(file: string, value: unknown) {
  ensureDirs()
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
}

export function listClients(): Client[] {
  const clients = readJson<Client[]>(path.join(DATA_DIR, 'clients.json'))
  return Array.isArray(clients) ? clients : []
}

export function getClient(id: string): Client | undefined {
  return listClients().find((c) => c.id === id)
}

export function listProgramFiles(): ProgramFile[] {
  ensureDirs()
  return readdirSync(PROGRAMS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson<ProgramFile>(path.join(PROGRAMS_DIR, f)))
    .filter((p): p is ProgramFile => p !== null)
}

export function getProgramFile(id: string): ProgramFile | null {
  return readJson<ProgramFile>(path.join(PROGRAMS_DIR, `${id}.json`))
}

export function getSyncState(id: string): SyncState | null {
  return readJson<SyncState>(path.join(SYNC_DIR, `${id}.json`))
}

export function writeSyncState(id: string, state: SyncState) {
  writeJson(path.join(SYNC_DIR, `${id}.json`), state)
}

export function deleteProgramData(id: string) {
  for (const file of [path.join(PROGRAMS_DIR, `${id}.json`), path.join(SYNC_DIR, `${id}.json`)]) {
    if (existsSync(file)) rmSync(file)
  }
}
