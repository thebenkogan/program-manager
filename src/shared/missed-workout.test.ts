import { describe, expect, test } from 'bun:test'
import { adjustMissedWorkout } from './missed-workout'
import type { ProgramDocument } from './types'
import { validateProgram } from './validate'

const fixture = (): ProgramDocument => ({
  version: 1,
  name: 'Example program',
  startDate: '2026-10-05',
  weeks: 2,
  sessions: [
    {
      date: '2026-10-05', title: 'Mon · Squat + Clean & Jerk', week: 1,
      exercises: [
        { name: 'Squat', sets: 3, reps: '5', intensity: '265 lb' },
        { name: 'Clean & Jerk', sets: 5, reps: '3', intensity: '225 lb', progressionGroup: 'olympic' },
        { name: 'Chin-Up', sets: 3, reps: 'AMRAP' },
      ],
    },
    {
      date: '2026-10-07', title: 'Wed · Squat + Press + Clean', week: 1,
      exercises: [
        { name: 'Squat', sets: 3, reps: '5', intensity: '270 lb' },
        { name: 'Press', sets: 1, reps: '3', intensity: '147.5 lb', backoff: '2x5 @ 132.5 lb' },
        { name: 'Clean', sets: 5, reps: '3', intensity: '230 lb', progressionGroup: 'olympic' },
        { name: 'Row', sets: 3, reps: '9' },
      ],
    },
    {
      date: '2026-10-10', title: 'Sat · Light Squat + Deadlift', week: 1,
      exercises: [
        { name: 'Light Squat', sets: 2, reps: '5', intensity: '215 lb', intensityFormula: { sourceExercise: 'Squat', sourceScope: 'sameWeek', factor: 0.8, roundToLb: 5 } },
        { name: 'Deadlift', sets: 1, reps: '5', intensity: '390 lb' },
      ],
    },
    {
      date: '2026-10-12', title: 'Mon · Squat + Clean & Jerk', week: 2,
      exercises: [
        { name: 'Squat', sets: 3, reps: '5', intensity: '275 lb' },
        { name: 'Clean & Jerk', sets: 5, reps: '3', intensity: '235 lb', progressionGroup: 'olympic' },
        { name: 'Row', sets: 3, reps: '10' },
      ],
    },
  ],
})

describe('missed-workout program metadata', () => {
  test('keeps optional exception metadata inside the public schema', () => {
    expect(validateProgram(fixture())).toEqual([])
  })
})

describe('skip missed workout', () => {
  test('shifts same-exercise values and explicitly shared counters, then recalculates derived loads', () => {
    const result = adjustMissedWorkout(fixture(), '2026-10-05', 'skip')
    expect(result.sessions.map((s) => s.date)).toEqual(['2026-10-07', '2026-10-10', '2026-10-12'])
    expect(result.sessions[0].exercises.find((e) => e.name === 'Squat')?.intensity).toBe('265 lb')
    expect(result.sessions[0].exercises.find((e) => e.name === 'Clean')?.intensity).toBe('225 lb')
    expect(result.sessions[0].exercises.find((e) => e.name === 'Press')?.backoff).toBe('2x5 @ 132.5 lb')
    expect(result.sessions[0].exercises.find((e) => e.name === 'Row')?.reps).toBe('9')
    expect(result.sessions[1].exercises.find((e) => e.name === 'Light Squat')?.intensity).toBe('210 lb')
    expect(result.sessions[1].exercises.find((e) => e.name === 'Deadlift')?.intensity).toBe('390 lb')
    expect(result.sessions[2].exercises.find((e) => e.name === 'Squat')?.intensity).toBe('270 lb')
    expect(result.sessions[2].exercises.find((e) => e.name === 'Clean & Jerk')?.intensity).toBe('230 lb')
    expect(result.sessions[2].exercises.find((e) => e.name === 'Row')?.reps).toBe('10')
  })

  test('uses a group source when heavy and light variants share a display name', () => {
    const program = fixture()
    for (const session of program.sessions) {
      for (const exercise of session.exercises) {
        if (exercise.name === 'Squat') exercise.progressionGroup = 'heavy-squat'
      }
    }
    const light = program.sessions[2].exercises[0]
    light.name = 'Squat'
    light.intensityFormula = {
      sourceProgressionGroup: 'heavy-squat', sourceScope: 'sameWeek', factor: 0.8, roundToLb: 5,
    }
    expect(validateProgram(program)).toEqual([])
    expect(adjustMissedWorkout(program, '2026-10-05', 'skip').sessions[1].exercises[0].intensity).toBe('210 lb')
  })
})

describe('defer missed workout', () => {
  test('infers the cadence from scheduled dates, moves sessions forward, and carries workouts with their loads', () => {
    const result = adjustMissedWorkout(fixture(), '2026-10-05', 'defer')
    expect(result.sessions.map((s) => [s.date, s.title, s.week])).toEqual([
      ['2026-10-07', 'Wed · Squat + Clean & Jerk', 1],
      ['2026-10-10', 'Sat · Squat + Press + Clean', 1],
      ['2026-10-12', 'Mon · Light Squat + Deadlift', 1],
      ['2026-10-14', 'Wed · Squat + Clean & Jerk', 2],
    ])
    expect(result.sessions[0].exercises.find((e) => e.name === 'Squat')?.intensity).toBe('265 lb')
    expect(result.sessions[1].exercises.find((e) => e.name === 'Squat')?.intensity).toBe('270 lb')
    expect(result.sessions[2].exercises.find((e) => e.name === 'Light Squat')?.intensity).toBe('210 lb')
    expect(result.weeks).toBe(2)
  })
})
