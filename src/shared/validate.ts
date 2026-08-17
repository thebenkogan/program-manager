import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js'
import schema from './program.schema.json'

const ajv = new Ajv2020({ allErrors: true, strict: false })
const validate = ajv.compile(schema)

function instancePathToStr(instancePath: string): string {
  if (!instancePath) return ''
  const parts = instancePath.split('/').slice(1)
  let out = ''
  for (const part of parts) {
    if (/^\d+$/.test(part)) out += `[${part}]`
    else out += out ? `.${part}` : part
  }
  return out
}

function formatError(e: ErrorObject): string {
  const path = instancePathToStr(e.instancePath)
  switch (e.keyword) {
    case 'const':
      return `${path}: must be 1`
    case 'required':
      return `${path ? `${path}.` : ''}${e.params.missingProperty}: required string`
    case 'pattern':
      return `${path}: must be YYYY-MM-DD`
    case 'type':
      return path === 'weeks' || path.endsWith('.sets') ? `${path}: positive integer required` : `${path}: required ${e.params.type}`
    case 'minimum':
      return `${path}: positive integer required`
    case 'minItems':
      return `${path}: non-empty array required`
    case 'minLength':
      return `${path}: required string`
    default:
      return `${path}: ${e.message ?? 'invalid'}`
  }
}

function parseDate(s: string): Date | null {
  const parts = s.split('-')
  if (parts.length !== 3) return null
  const d = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]))
  if (isNaN(d.getTime())) return null
  const check = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  if (check !== s) return null
  return d
}

function formatISODate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

export function validateProgram(doc: unknown): string[] {
  validate(doc)
  const errors = validate.errors ? validate.errors.map(formatError) : []

  const d = doc as Record<string, unknown> | null
  if (d !== null && typeof d === 'object' && Array.isArray(d.sessions)) {
    const weeks = typeof d.weeks === 'number' ? d.weeks : null
    if (weeks !== null) {
      d.sessions.forEach((s, i) => {
        const sess = s as Record<string, unknown>
        if (typeof sess.week === 'number' && sess.week > weeks) {
          errors.push(`sessions[${i}].week: must be integer in 1..${weeks}`)
        }
      })
    }

    if (typeof d.startDate === 'string') {
      const sd = parseDate(d.startDate)
      if (sd === null) {
        errors.push('startDate: invalid date')
      } else if (typeof d.weeks === 'number') {
        const endDateMs = sd.getTime() + d.weeks * 7 * 24 * 60 * 60 * 1000
        const endStr = formatISODate(new Date(endDateMs))
        d.sessions.forEach((s, i) => {
          const sess = s as Record<string, unknown>
          if (typeof sess.date !== 'string') return
          const sessionDate = parseDate(sess.date)
          if (sessionDate === null) {
            errors.push(`sessions[${i}].date: invalid date`)
          } else if (sessionDate.getTime() < sd.getTime() || sessionDate.getTime() >= endDateMs) {
            errors.push(`sessions[${i}].date: must be within program date range (${d.startDate} to ${endStr})`)
          }
        })
      }
    }
  }

  return errors
}
