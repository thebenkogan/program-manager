import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { ROOT } from './store.ts'
import type { DiffLine, FileStatus, ParsedDiff, ProgramDocument, VersionInfo } from '../shared/types.ts'

const GIT_IDENTITY = ['-c', 'user.name=Coach', '-c', 'user.email=coach@local']

function run(...args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 })
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
    out = run('status', '--porcelain', '--', 'data')
  } catch {
    return []
  }
  const files: FileStatus[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const code = line.slice(0, 2).trim()
    const file = line.slice(3)
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
  const out = run('diff', '--no-color', '--', rel)
  return out.trim() ? parseUnifiedDiff(out) : null
}

export function commitFile(rel: string, message: string): string {
  run('add', '--', rel)
  run(...GIT_IDENTITY, 'commit', '-m', message)
  return run('rev-parse', 'HEAD').trim()
}

export function discardFile(rel: string) {
  const status = dataFileStatus().find((s) => s.path === rel)
  if (status?.state === 'added') {
    rmSync(path.join(ROOT, rel))
  } else {
    run('checkout', '--', rel)
  }
}

export function deleteTrackedProgram(rel: string, message: string) {
  try {
    run('rm', '-f', '--', rel)
    run(...GIT_IDENTITY, 'commit', '-m', message)
  } catch {
    // file was not tracked; already removed from disk
  }
}

export function programHistory(id: string): VersionInfo[] {
  const rel = `data/programs/${id}.json`
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
    const out = run('show', '--no-color', `${ref}:${rel}`)
    const parsed = JSON.parse(out) as { doc?: ProgramDocument }
    return parsed.doc ?? null
  } catch {
    return null
  }
}

export function programVersionDiff(id: string, hash: string): ParsedDiff | null {
  const rel = `data/programs/${id}.json`
  try {
    const out = run('show', '--no-color', '--format=', hash, '--', rel)
    return out.trim() ? parseUnifiedDiff(out) : null
  } catch {
    return null
  }
}
