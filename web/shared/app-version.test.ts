import { describe, expect, test } from 'bun:test'
import { bundleName, isStale } from './app-version.ts'

describe('bundleName', () => {
  test('takes the basename from a script src', () => {
    expect(bundleName('/assets/index-C1plZ6Pp.js')).toBe('index-C1plZ6Pp.js')
    expect(bundleName('https://coach.bkogan.com/assets/index-CIWA6x4l.js')).toBe('index-CIWA6x4l.js')
  })

  test('ignores a cache-busting query or hash', () => {
    expect(bundleName('/assets/index-C1plZ6Pp.js?v=2')).toBe('index-C1plZ6Pp.js')
    expect(bundleName('/assets/index-C1plZ6Pp.js#x')).toBe('index-C1plZ6Pp.js')
  })

  test('returns null when there is nothing to read', () => {
    expect(bundleName(null)).toBeNull()
    expect(bundleName(undefined)).toBeNull()
    expect(bundleName('')).toBeNull()
  })
})

describe('isStale', () => {
  test('a differing build is stale', () => {
    expect(isStale('index-old.js', 'index-new.js')).toBe(true)
  })

  test('the same build is not stale', () => {
    expect(isStale('index-a.js', 'index-a.js')).toBe(false)
  })

  test('an unknown version is never reported as stale', () => {
    expect(isStale(null, 'index-a.js')).toBe(false)
    expect(isStale('index-a.js', null)).toBe(false)
    expect(isStale(null, null)).toBe(false)
  })
})
