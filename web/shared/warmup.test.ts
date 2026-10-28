import { describe, expect, test } from 'bun:test'
import { formatWarmup, parseWeight, roundTo5, suggestWarmup, warmupPresetFor } from './warmup'

describe('warmup helpers', () => {
  test('parses plain lb intensities only', () => {
    expect(parseWeight('290 lb')).toBe(290)
    expect(parseWeight('147.5 lb')).toBe(147.5)
    expect(parseWeight('80%')).toBeNull()
    expect(parseWeight(undefined)).toBeNull()
  })

  test('rounds to nearest 5 with halves up', () => {
    expect(roundTo5(202.5)).toBe(205)
    expect(roundTo5(261)).toBe(260)
  })

  test('classifies loaded lifts', () => {
    expect(warmupPresetFor('High Bar Back Squat')).toBe('standard')
    expect(warmupPresetFor('High Bar Back Squat (light)')).toBe('standard')
    expect(warmupPresetFor('Overhead Press')).toBe('standard')
    expect(warmupPresetFor('Clean & Jerk')).toBe('standard')
    expect(warmupPresetFor('Deadlift')).toBe('deadlift')
    expect(warmupPresetFor('Chin-Up')).toBeNull()
  })
})

describe('suggestWarmup', () => {
  test('squat 290: bar, half, three-quarter, 90% single', () => {
    expect(suggestWarmup('High Bar Back Squat', '290 lb')).toEqual([
      { weight: 45, reps: 5 },
      { weight: 145, reps: 5 },
      { weight: 220, reps: 3 },
      { weight: 260, reps: 1 },
    ])
  })

  test('press 155 stays on 5 lb marks', () => {
    expect(suggestWarmup('Overhead Press', '155 lb')).toEqual([
      { weight: 45, reps: 5 },
      { weight: 80, reps: 5 },
      { weight: 115, reps: 3 },
      { weight: 140, reps: 1 },
    ])
  })

  test('deadlift 405 gets extra singles, no empty bar', () => {
    const sets = suggestWarmup('Deadlift', '405 lb')
    expect(sets).toEqual([
      { weight: 135, reps: 5 },
      { weight: 225, reps: 3 },
      { weight: 315, reps: 1 },
      { weight: 365, reps: 1 },
    ])
    // Last warm-up is the 90% single.
    expect(sets.at(-1)!.weight).toBe(365)
  })

  test('light deadlift starts at the bar, never at one plate', () => {
    expect(suggestWarmup('Deadlift', '70 lb')).toEqual([
      { weight: 45, reps: 5 },
      { weight: 55, reps: 3 },
      { weight: 65, reps: 1 },
    ])
  })

  test('mid-range deadlift keeps the empty-bar start', () => {
    expect(suggestWarmup('Deadlift', '135 lb')).toEqual([
      { weight: 45, reps: 5 },
      { weight: 70, reps: 3 },
      { weight: 100, reps: 3 },
      { weight: 120, reps: 1 },
    ])
    expect(suggestWarmup('Deadlift', '225 lb')[0]).toEqual({ weight: 45, reps: 5 })
  })

  test('one-plate start only above 245 lb', () => {
    expect(suggestWarmup('Deadlift', '245 lb')[0]).toEqual({ weight: 135, reps: 5 })
    expect(suggestWarmup('Deadlift', '240 lb')[0]).toEqual({ weight: 45, reps: 5 })
    // One plate, then straight to the 90% single: no room for a second plate.
    expect(suggestWarmup('Deadlift', '245 lb')).toEqual([
      { weight: 135, reps: 5 },
      { weight: 220, reps: 1 },
    ])
    // A 500 lb pull keeps loading plates until 90% is the only rung left.
    expect(suggestWarmup('Deadlift', '500 lb')).toEqual([
      { weight: 135, reps: 5 },
      { weight: 225, reps: 3 },
      { weight: 315, reps: 1 },
      { weight: 405, reps: 1 },
      { weight: 450, reps: 1 },
    ])
  })

  test('bodyweight and unloaded lifts get no ladder', () => {
    expect(suggestWarmup('Chin-Up', undefined)).toEqual([])
    expect(suggestWarmup('Deadlift', undefined)).toEqual([])
  })

  test('too-light lifts get no ladder', () => {
    expect(suggestWarmup('Overhead Press', '60 lb')).toEqual([])
  })

  test('a light press still gets bar, triple, single', () => {
    expect(suggestWarmup('Overhead Press', '85 lb')).toEqual([
      { weight: 45, reps: 5 },
      { weight: 65, reps: 3 },
      { weight: 75, reps: 1 },
    ])
  })

  test('formats display-ready', () => {
    expect(formatWarmup(suggestWarmup('High Bar Back Squat', '290 lb'))).toBe('45×5 · 145×5 · 220×3 · 260×1')
  })
})
