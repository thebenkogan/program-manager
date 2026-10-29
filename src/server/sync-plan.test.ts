import { describe, expect, test } from 'bun:test'
import { desiredEvents, planSync, type DesiredEvent, type RemoteEvent } from './sync-plan.ts'
import type { ProgramDocument } from '../shared/types.ts'

function body(date: string, weight: string): DesiredEvent {
  return {
    date,
    endDate: date,
    summary: `🏋️ ${date}`,
    description: `Squat — 3×5 @ ${weight} lb`,
  }
}

function remoteFrom(events: DesiredEvent[], idFor: (d: string) => string): RemoteEvent[] {
  return events.map((e) => ({
    id: idFor(e.date),
    summary: e.summary,
    description: e.description,
    startDate: e.date,
    endDate: e.endDate,
  }))
}

const A = body('2026-11-02', '275')
const B = body('2026-11-04', '280')
const C = body('2026-11-07', '220')

describe('planSync', () => {
  test('nothing changed means no writes at all', () => {
    const plan = planSync([A, B, C], remoteFrom([A, B, C], (d) => `id-${d}`))
    expect(plan.updates).toEqual([])
    expect(plan.inserts).toEqual([])
    expect(plan.deletes).toEqual([])
    expect(plan.unchanged.map((u) => u.date)).toEqual([A.date, B.date, C.date])
  })

  test('a single edited session patches only that event and keeps its ID', () => {
    const was = [A, B, C]
    const remote = remoteFrom(was, (d) => `id-${d}`)
    const now = [A, body(B.date, '285'), C]
    const plan = planSync(now, remote)
    expect(plan.updates).toEqual([{ eventId: `id-${B.date}`, body: now[1] }])
    expect(plan.inserts).toEqual([])
    expect(plan.deletes).toEqual([])
    expect(plan.unchanged.length).toBe(2)
  })

  test('removing a session deletes its event only', () => {
    const remote = remoteFrom([A, B, C], (d) => `id-${d}`)
    const plan = planSync([A, C], remote)
    expect(plan.deletes.map((d) => d.id)).toEqual([`id-${B.date}`])
    expect(plan.inserts).toEqual([])
    expect(plan.unchanged.length).toBe(2)
  })

  test('adding a session inserts one event', () => {
    const remote = remoteFrom([A, B], (d) => `id-${d}`)
    const D = body('2026-11-09', '285')
    const plan = planSync([A, B, D], remote)
    expect(plan.inserts).toEqual([D])
    expect(plan.deletes).toEqual([])
    expect(plan.updates).toEqual([])
  })

  test('moving a date deletes the old event and inserts the new one', () => {
    const remote = remoteFrom([A], (d) => `id-${d}`)
    const moved = body('2026-11-03', '275')
    const plan = planSync([moved], remote)
    expect(plan.inserts).toEqual([moved])
    expect(plan.deletes.map((d) => d.id)).toEqual([`id-${A.date}`])
  })

  test('hand-made events on the calendar are left alone', () => {
    const remote: RemoteEvent[] = [
      ...remoteFrom([A], (d) => `id-${d}`),
      { id: 'dentist', summary: 'Dentist', startDate: '2026-11-05', endDate: '2026-11-06' },
    ]
    const plan = planSync([A], remote)
    expect(plan.deletes).toEqual([])
  })

  test('a stale duplicate of our own event on the same date is deleted', () => {
    const remote: RemoteEvent[] = [
      { id: 'old', summary: '🏋️ Mon', description: 'x', startDate: A.date, endDate: A.date },
      { id: 'current', summary: A.summary, description: A.description, startDate: A.date, endDate: A.endDate },
    ]
    const plan = planSync([A], remote, [{ date: A.date, eventId: 'current', link: '' }])
    expect(plan.unchanged).toEqual([{ eventId: 'current', date: A.date }])
    expect(plan.deletes.map((d) => d.id)).toEqual(['old'])
  })

  test('previous sync state wins when several events share a date', () => {
    const remote: RemoteEvent[] = [
      { id: 'stray', summary: '🏋️ X', description: 'x', startDate: A.date, endDate: A.date },
      { id: 'known', summary: '🏋️ Y', description: 'y', startDate: A.date, endDate: A.date },
    ]
    const plan = planSync([A], remote, [{ date: A.date, eventId: 'known', link: '' }])
    expect(plan.updates.map((u) => u.eventId)).toEqual(['known'])
    expect(plan.deletes.map((d) => d.id)).toEqual(['stray'])
  })
})

describe('desiredEvents', () => {
  test('maps sessions to event bodies', () => {
    const doc = {
      version: 1,
      name: 'P',
      startDate: '2026-11-02',
      weeks: 1,
      sessions: [{ date: '2026-11-02', week: 1, title: 'Mon · Squat', exercises: [] }],
    } as unknown as ProgramDocument
    const out = desiredEvents(doc, (t) => `🏋️ ${t}`, () => 'desc', (d) => d)
    expect(out).toEqual([
      { date: '2026-11-02', endDate: '2026-11-02', summary: '🏋️ Mon · Squat', description: 'desc' },
    ])
  })
})
