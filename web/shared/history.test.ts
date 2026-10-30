import { describe, expect, test } from 'bun:test'
import type { Session } from '../../src/shared/types'
import { mergeProgramHistory } from './history'

function s(date: string, ex: { name: string; intensity: string }[]): Session {
  return { date, title: date, week: 1, exercises: ex.map((e) => ({ ...e, sets: 3, reps: '5' })) }
}

const dl = (w: string) => [{ name: 'Deadlift', intensity: `${w} lb` }]

describe('mergeProgramHistory', () => {
  test('keeps sessions from superseded blocks', () => {
    const versions = [
      { sha: 'a', sessions: [s('2026-08-01', dl('300')), s('2026-08-08', dl('305'))] },
      { sha: 'b', sessions: [s('2026-08-15', dl('310'))] }, // replaced the block
    ]
    const merged = mergeProgramHistory(versions, [s('2026-08-22', dl('315'))])
    expect(merged.map((x) => x.date)).toEqual(['2026-08-01', '2026-08-08', '2026-08-15', '2026-08-22'])
  })

  test('edits inside a block keep the latest value', () => {
    const versions = [
      { sha: 'a', sessions: [s('2026-08-01', dl('300')), s('2026-08-08', dl('305'))] },
      { sha: 'b', sessions: [s('2026-08-01', dl('300')), s('2026-08-08', dl('310'))] },
    ]
    expect(mergeProgramHistory(versions, [])[1].exercises[0].intensity).toBe('310 lb')
  })

  test('a session deleted as skipped is not resurrected', () => {
    const versions = [
      { sha: 'a', sessions: [s('2026-08-01', dl('300')), s('2026-08-08', dl('305')), s('2026-08-15', dl('310'))] },
      { sha: 'b', sessions: [s('2026-08-01', dl('300')), s('2026-08-15', dl('310'))] }, // 08-08 skipped
    ]
    expect(mergeProgramHistory(versions, []).map((x) => x.date)).toEqual(['2026-08-01', '2026-08-15'])
  })

  test('live program wins on overlapping dates', () => {
    const versions = [{ sha: 'a', sessions: [s('2026-08-01', dl('300'))] }]
    const merged = mergeProgramHistory(versions, [s('2026-08-01', dl('400'))])
    expect(merged).toHaveLength(1)
    expect(merged[0].exercises[0].intensity).toBe('400 lb')
  })

  test('empty history is just the live program', () => {
    const live = [s('2026-08-01', dl('300'))]
    expect(mergeProgramHistory([], live)).toEqual(live)
  })
})
