import { createHash } from 'node:crypto'

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`
}

export function docHash(doc: unknown): string {
  return createHash('sha256').update(canonicalize(doc)).digest('hex').slice(0, 16)
}
