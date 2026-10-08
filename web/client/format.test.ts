import { describe, expect, test } from 'bun:test'
import {
  signInError,
  formatChange,
  formatDate,
  formatLongDate,
  formatPrescription,
  formatShortDate,
  formatWeight,
  groupBy,
  passwordError,
  pluralize,
} from './format'

describe('formatDate', () => {
  test('formats calendar dates without timezone shift', () => {
    expect(formatDate('2026-10-03')).toBe('Sat, Oct 3')
    expect(formatDate('2026-01-01')).toBe('Thu, Jan 1')
    expect(formatDate('2026-12-31')).toBe('Thu, Dec 31')
  })
  test('short and long forms', () => {
    expect(formatShortDate('2026-10-03')).toBe('Oct 3')
    expect(formatLongDate('2026-10-03')).toBe('Oct 3, 2026')
  })
})

describe('formatPrescription', () => {
  test('with and without intensity', () => {
    expect(formatPrescription(3, '5')).toBe('3 x 5')
    expect(formatPrescription(3, '5', '80%')).toBe('3 x 5 @ 80%')
    expect(formatPrescription(4, '6-8', 'RPE 8')).toBe('4 x 6-8 @ RPE 8')
  })
})

describe('formatChange', () => {
  test('signs positive, negative and zero', () => {
    expect(formatChange(10)).toBe('+10 lb')
    expect(formatChange(-5)).toBe('-5 lb')
    expect(formatChange(0)).toBe('0 lb')
    expect(formatChange(2.5)).toBe('+2.5 lb')
  })
  test('avoids -0 and float noise', () => {
    expect(formatChange(-0.01)).toBe('0 lb')
    expect(formatChange(0.1 + 0.2)).toBe('+0.3 lb')
  })
})

describe('formatWeight', () => {
  test('rounds to one decimal', () => {
    expect(formatWeight(185)).toBe('185 lb')
    expect(formatWeight(132.25)).toBe('132.3 lb')
  })
})

describe('pluralize', () => {
  test('singular and plural', () => {
    expect(pluralize(1, 'workout')).toBe('1 workout')
    expect(pluralize(0, 'workout')).toBe('0 workouts')
    expect(pluralize(2, 'child', 'children')).toBe('2 children')
  })
})

describe('groupBy', () => {
  test('groups preserving order', () => {
    const groups = groupBy(
      [
        { week: 1, d: 'a' },
        { week: 2, d: 'b' },
        { week: 1, d: 'c' },
      ],
      (x) => x.week,
    )
    expect(groups.map((g) => g.key)).toEqual([1, 2])
    expect(groups[0].items.map((x) => x.d)).toEqual(['a', 'c'])
  })
})

describe('passwordError', () => {
  test('enforces min length and match', () => {
    expect(passwordError('short', 'short')).toBe('Password must be at least 8 characters.')
    expect(passwordError('longenough', 'different')).toBe('Passwords do not match.')
    expect(passwordError('longenough', 'longenough')).toBeNull()
  })
})

describe('signInError', () => {
  test('requires email and password before any request', () => {
    expect(signInError('', 'x')).toBe('Enter your email.')
    expect(signInError('   ', 'x')).toBe('Enter your email.')
    expect(signInError('a@b', '')).toBe('Enter a valid email address.')
    expect(signInError('benkogan9@gmail.com', '')).toBe('Enter your password.')
  })
  test('accepts a well-formed email with a password', () => {
    expect(signInError(' benkogan9@gmail.com ', 'pw')).toBeNull()
  })
})
