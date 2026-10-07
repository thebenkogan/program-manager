import { describe, expect, test } from 'bun:test'
import { buildProgress, classifySessions, nextSession, parseWeight, todayPacific } from './progress'
import type { Session } from '../../src/shared/types'

const ex = (name: string, intensity?: string) => ({ name, sets: 3, reps: '5', intensity })
const sess = (date: string, exercises: ReturnType<typeof ex>[]): Session => ({
  date,
  title: `Session ${date}`,
  week: 1,
  exercises,
})

describe('parseWeight', () => {
  test('parses leading lb weights', () => {
    expect(parseWeight('255 lb')).toBe(255)
    expect(parseWeight('77.5 lb')).toBe(77.5)
    expect(parseWeight('145lb')).toBe(145)
    expect(parseWeight('100 lbs')).toBe(100)
    expect(parseWeight('  60 lb  ')).toBe(60)
  })
  test('rejects non-weight text', () => {
    expect(parseWeight('80% of squat')).toBeNull()
    expect(parseWeight('AMRAP')).toBeNull()
    expect(parseWeight('Bodyweight')).toBeNull()
    expect(parseWeight('')).toBeNull()
    expect(parseWeight(undefined)).toBeNull()
  })
})

describe('todayPacific', () => {
  test('uses Pacific date, not UTC', () => {
    // 2026-10-07 02:00 UTC is still 2026-10-06 in Los Angeles (PDT, UTC-7).
    expect(todayPacific(new Date('2026-10-07T02:00:00Z'))).toBe('2026-10-06')
    // 2026-10-07 20:00 UTC is 2026-10-07 13:00 Pacific.
    expect(todayPacific(new Date('2026-10-07T20:00:00Z'))).toBe('2026-10-07')
  })
  test('returns YYYY-MM-DD', () => {
    expect(todayPacific()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('classifySessions / nextSession boundary', () => {
  const today = '2026-10-07'
  const sessions = [
    sess('2026-10-09', [ex('Squat', '205 lb')]),
    sess('2026-10-05', [ex('Squat', '200 lb')]),
    sess('2026-10-07', [ex('Squat', '210 lb')]),
  ]

  test('session dated today is upcoming, earlier is done', () => {
    const view = classifySessions(sessions, today)
    expect(view.map((s) => [s.date, s.status])).toEqual([
      ['2026-10-05', 'done'],
      ['2026-10-07', 'upcoming'],
      ['2026-10-09', 'upcoming'],
    ])
  })

  test('next workout is the session dated today when today has one', () => {
    expect(nextSession(sessions, today)?.date).toBe('2026-10-07')
  })

  test('next workout is null when all sessions are past', () => {
    expect(nextSession(sessions, '2026-11-01')).toBeNull()
  })

  test('next workout does not carry a status field', () => {
    expect(nextSession(sessions, today)).not.toHaveProperty('status')
  })
})

describe('buildProgress', () => {
  test('empty program', () => {
    expect(buildProgress([], '2026-10-07')).toEqual({ completedWorkouts: 0, exercises: [] })
  })

  test('points are completed sessions only, sorted by date', () => {
    const sessions = [
      sess('2026-10-05', [ex('Squat', '255 lb')]),
      sess('2026-10-02', [ex('Squat', '250 lb')]),
      sess('2026-10-07', [ex('Squat', '260 lb')]),
    ]
    const res = buildProgress(sessions, '2026-10-07')
    expect(res.completedWorkouts).toBe(2)
    expect(res.exercises).toEqual([
      {
        name: 'Squat',
        points: [
          { date: '2026-10-02', weight: 250 },
          { date: '2026-10-05', weight: 255 },
        ],
        firstWeight: 250,
        currentWeight: 255,
        change: 5,
      },
    ])
  })

  test('exercise with no numeric weight is excluded', () => {
    const sessions = [
      sess('2026-10-01', [ex('Chin-Up', 'AMRAP'), ex('Squat', '200 lb'), ex('Row')]),
      sess('2026-10-03', [ex('Chin-Up', 'AMRAP')]),
    ]
    const res = buildProgress(sessions, '2026-10-07')
    expect(res.exercises.map((e) => e.name)).toEqual(['Squat'])
    expect(res.completedWorkouts).toBe(2)
  })

  test('change is negative when the weight went down', () => {
    const sessions = [
      sess('2026-10-01', [ex('Deadlift', '385 lb')]),
      sess('2026-10-03', [ex('Deadlift', '370 lb')]),
    ]
    const [d] = buildProgress(sessions, '2026-10-07').exercises
    expect(d.firstWeight).toBe(385)
    expect(d.currentWeight).toBe(370)
    expect(d.change).toBe(-15)
  })

  test('uses next scheduled weight when nothing is completed', () => {
    const sessions = [
      sess('2026-10-09', [ex('Bench', '205 lb')]),
      sess('2026-10-12', [ex('Bench', '210 lb')]),
    ]
    const [b] = buildProgress(sessions, '2026-10-07').exercises
    expect(b.points).toEqual([])
    expect(b.firstWeight).toBe(205)
    expect(b.currentWeight).toBe(205)
    expect(b.change).toBe(0)
    expect(buildProgress(sessions, '2026-10-07').completedWorkouts).toBe(0)
  })

  test('first weight comes from the earliest session even when it is not the first in input order', () => {
    const sessions = [
      sess('2026-10-05', [ex('Squat', '260 lb')]),
      sess('2026-10-01', [ex('Squat', '250 lb')]),
    ]
    const [s] = buildProgress(sessions, '2026-10-07').exercises
    expect(s.firstWeight).toBe(250)
    expect(s.currentWeight).toBe(260)
    expect(s.change).toBe(10)
  })

  test('exercises ordered by first appearance; names are exact (case and variants differ)', () => {
    const sessions = [
      sess('2026-10-01', [ex('Clean & Jerk', '215 lb'), ex('Squat', '200 lb')]),
      sess('2026-10-03', [ex('Clean', '190 lb'), ex('Squat', '205 lb'), ex('Clean & Jerk', '220 lb')]),
    ]
    const res = buildProgress(sessions, '2026-10-07')
    expect(res.exercises.map((e) => e.name)).toEqual(['Clean & Jerk', 'Squat', 'Clean'])
    expect(res.exercises[0].change).toBe(5)
  })

  test('future-only exercises do not count toward completedWorkouts', () => {
    const sessions = [sess('2026-10-07', [ex('Squat', '200 lb')]), sess('2026-10-09', [ex('Squat', '205 lb')])]
    expect(buildProgress(sessions, '2026-10-07').completedWorkouts).toBe(0)
  })
})
