import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { DATA_DIR, ROOT } from './store.ts'
import type { DiffLine, FileStatus, ParsedDiff, ProgramDocument, VersionInfo } from '../shared/types.ts'

const GIT_IDENTITY = ['-c', 'user.name=Coach', '-c', 'user.email=coach@local']

// Client data lives in its own nested git repo under data/ (the parent repo
// ignores data/ so client info is never pushed). All git ops below run with
// cwd=data and data-stripped paths; the public interface keeps `data/...`
// paths so callers are unaffected.
function run(...args: string[]): string {
  return execFileSync('git', args, { cwd: DATA_DIR, encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 })
}

/** Strip the `data/` prefix for git commands run inside the data repo. */
function g(rel: string): string {
  return rel.replace(/^data\//, '')
}

export function parseUnifiedDiff(text: string): ParsedDiff {
  const lines: DiffLine[] = []
  let added = 0
  let removed = 0
  let oldLine: number | null = null
  let newLine: number | null = null

  for (const raw of text.split('\n')) {
    if (raw.startsWith('@@')) {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      oldLine = m ? Number(m[1]) : null
      newLine = m ? Number(m[2]) : null
      continue
    }
    if (
      raw.startsWith('diff --git') || raw.startsWith('index ') ||
      raw.startsWith('--- ') || raw.startsWith('+++ ') ||
      raw.startsWith('new file') || raw.startsWith('deleted file')
    ) {
      continue
    }
    if (raw.startsWith('+')) {
      lines.push({ type: 'add', text: raw.slice(1), oldLine: null, newLine })
      added++
      if (newLine !== null) newLine++
    } else if (raw.startsWith('-')) {
      lines.push({ type: 'del', text: raw.slice(1), oldLine, newLine: null })
      removed++
      if (oldLine !== null) oldLine++
    } else {
      lines.push({ type: 'ctx', text: raw.slice(1), oldLine, newLine })
      if (oldLine !== null) oldLine++
      if (newLine !== null) newLine++
    }
  }

  return { stats: { added, removed }, lines }
}

export function dataFileStatus(): FileStatus[] {
  let out: string
  try {
    out = run('status', '--porcelain', '--', 'programs', 'clients.json')
  } catch {
    return []
  }
  const files: FileStatus[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const code = line.slice(0, 2).trim()
    const file = `data/${line.slice(3)}`
    if (code === '??') files.push({ path: file, state: 'added' })
    else if (code.includes('M')) files.push({ path: file, state: 'modified' })
    else if (code.includes('D')) files.push({ path: file, state: 'deleted' })
  }
  return files
}

function fileAsAdded(rel: string): ParsedDiff {
  const content = readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\n$/, '')
  const lines: DiffLine[] = content.split('\n').map((text, i) => ({
    type: 'add',
    text,
    oldLine: null,
    newLine: i + 1,
  }))
  return { stats: { added: lines.length, removed: 0 }, lines }
}

export function programDiff(id: string): ParsedDiff | null {
  const rel = `data/programs/${id}.json`
  let status: FileStatus | undefined
  try {
    status = dataFileStatus().find((s) => s.path === rel)
  } catch {
    return null
  }
  if (!status || status.state === 'deleted') return null
  if (status.state === 'added') return fileAsAdded(rel)
  const out = run('diff', '--no-color', '--', g(rel))
  return out.trim() ? parseUnifiedDiff(out) : null
}

export function commitFile(rel: string, message: string): string {
  run('add', '--', g(rel))
  run(...GIT_IDENTITY, 'commit', '-m', message)
  return run('rev-parse', 'HEAD').trim()
}

export function discardFile(rel: string) {
  const status = dataFileStatus().find((s) => s.path === rel)
  if (status?.state === 'added') {
    rmSync(path.join(ROOT, rel))
  } else {
    run('checkout', '--', g(rel))
  }
}

export function deleteTrackedProgram(rel: string, message: string) {
  try {
    run('rm', '-f', '--', g(rel))
    run(...GIT_IDENTITY, 'commit', '-m', message)
  } catch {
    // file was not tracked; already removed from disk
  }
}

export function programHistory(id: string): VersionInfo[] {
  const rel = g(`data/programs/${id}.json`)
  try {
    const out = run('log', '--no-color', `--format=%H|%h|%cI|%s`, '--', rel)
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, shortHash, date, ...rest] = line.split('|')
        return { hash, shortHash, date, message: rest.join('|') }
      })
  } catch {
    return []
  }
}

export function programDocAtRef(rel: string, ref: string): ProgramDocument | null {
  try {
    const out = run('show', '--no-color', `${ref}:${g(rel)}`)
    const parsed = JSON.parse(out) as { doc?: ProgramDocument }
    return parsed.doc ?? null
  } catch {
    return null
  }
}

function emptyTreeHash(): string {
  try {
    return run('hash-object', '-t', 'tree', '--stdin').trim()
  } catch {
    return '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
  }
}

export function programDocBeforeCommit(rel: string, hash: string): ProgramDocument | null {
  return programDocAtRef(rel, `${hash}^`) ?? programDocAtRef(rel, emptyTreeHash())
}

export function programVersionDiff(id: string, hash: string): ParsedDiff | null {
  const rel = g(`data/programs/${id}.json`)
  try {
    const out = run('show', '--no-color', '--format=', hash, '--', rel)
    return out.trim() ? parseUnifiedDiff(out) : null
  } catch {
    return null
  }
}
