import type { ReactNode } from 'react'
import type { Exercise, ProgramDocument, Session } from '../shared/types'
import { Card, CoachCue, cn } from './components'
import { fullDate } from './format'

interface Props {
  oldDoc: ProgramDocument | null
  newDoc: ProgramDocument
}

interface MetaChange {
  field: string
  old: unknown
  new: unknown
}

type ExChange =
  | { kind: 'added'; exercise: Exercise }
  | { kind: 'removed'; exercise: Exercise }
  | { kind: 'changed'; name: string; changes: MetaChange[] }
  | { kind: 'same'; exercise: Exercise }

type SessionChange =
  | { kind: 'added'; session: Session }
  | { kind: 'removed'; session: Session }
  | { kind: 'changed'; session: Session; old: Session; fields: MetaChange[]; exercises: ExChange[] }

interface WeekChange {
  week: number
  sessions: SessionChange[]
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

const SESSION_FIELDS = ['date', 'title', 'focus', 'notes'] as const
const EX_FIELDS = ['sets', 'reps', 'intensity', 'supersetWith', 'notes'] as const

function exLine(ex: Exercise): string {
  const parts = [
    `${ex.sets}×${ex.reps}`,
    ex.intensity ? `@ ${ex.intensity}` : null,
    ex.supersetWith ? `superset ${ex.supersetWith}` : null,
    ex.notes ? `(${ex.notes})` : null,
  ].filter(Boolean).join(' · ')
  return parts
}

function changedFields<T extends object>(oldV: T, newV: T): MetaChange[] {
  return (Object.keys(oldV) as (keyof T & string)[])
    .filter((k) => k !== 'coachNote' && oldV[k] !== newV[k])
    .map((k) => ({ field: k, old: oldV[k], new: newV[k] }))
}

function compareSessions(oldS: Session, newS: Session): ExChange[] {
  const oldBy = new Map(oldS.exercises.map((e) => [e.name, e]))
  const newBy = new Map(newS.exercises.map((e) => [e.name, e]))
  const names = [...new Set([...oldBy.keys(), ...newBy.keys()])]
  const exercises: ExChange[] = []
  for (const name of names) {
    const o = oldBy.get(name)
    const n = newBy.get(name)
    if (!o) exercises.push({ kind: 'added', exercise: n! })
    else if (!n) exercises.push({ kind: 'removed', exercise: o })
    else {
      const changes = changedFields(o, n)
      exercises.push(changes.length > 0 ? { kind: 'changed', name, changes } : { kind: 'same', exercise: o })
    }
  }
  return exercises
}

function matchSessions(oldSessions: Session[], newSessions: Session[]): SessionChange[] {
  const group = (sessions: Session[]) => {
    const byWeek = new Map<number, Session[]>()
    for (const s of sessions) {
      if (!byWeek.has(s.week)) byWeek.set(s.week, [])
      byWeek.get(s.week)!.push(s)
    }
    for (const arr of byWeek.values()) arr.sort((a, b) => (a.date < b.date ? -1 : 1))
    return byWeek
  }

  const oldByWeek = group(oldSessions)
  const newByWeek = group(newSessions)
  const weeks = [...new Set([...oldByWeek.keys(), ...newByWeek.keys()])].sort((a, b) => a - b)

  const out: SessionChange[] = []
  for (const week of weeks) {
    const olds = oldByWeek.get(week) ?? []
    const news = newByWeek.get(week) ?? []
    for (let i = 0; i < Math.max(olds.length, news.length); i++) {
      const o = olds[i]
      const n = news[i]
      if (o && n) {
        const fields = SESSION_FIELDS.filter((f) => o[f] !== n[f]).map((f) => ({ field: f, old: o[f], new: n[f] }))
        const exercises = compareSessions(o, n)
        out.push({ kind: 'changed', session: n, old: o, fields, exercises })
      } else if (n) {
        out.push({ kind: 'added', session: n })
      } else {
        out.push({ kind: 'removed', session: o! })
      }
    }
  }
  return out
}

function realChange(change: SessionChange | null): boolean {
  return change !== null && (change.kind !== 'changed' || change.fields.length > 0 || change.exercises.some((e) => e.kind !== 'same'))
}

function buildChanges(oldDoc: ProgramDocument, newDoc: ProgramDocument): { meta: MetaChange[]; weeks: WeekChange[] } {
  const meta = [
    { field: 'name', old: oldDoc.name, new: newDoc.name },
    { field: 'goal', old: oldDoc.goal, new: newDoc.goal },
    { field: 'startDate', old: oldDoc.startDate, new: newDoc.startDate },
    { field: 'weeks', old: oldDoc.weeks, new: newDoc.weeks },
    { field: 'notes', old: oldDoc.notes, new: newDoc.notes },
  ].filter((c) => c.old !== c.new)

  const weeks = new Map<number, SessionChange[]>()
  for (const change of matchSessions(oldDoc.sessions, newDoc.sessions)) {
    if (!realChange(change)) continue
    if (!weeks.has(change.session.week)) weeks.set(change.session.week, [])
    weeks.get(change.session.week)!.push(change)
  }

  return {
    meta,
    weeks: [...weeks.entries()]
      .map(([week, sessions]) => ({ week, sessions }))
      .filter((w) => w.sessions.length > 0),
  }
}

function ToneBlock({ tone, children }: { tone: 'add' | 'del' | 'changed' | 'ctx'; children: ReactNode }) {
  const cls =
    tone === 'add'
      ? 'border-green-500/30 bg-green-500/[0.04]'
      : tone === 'del'
        ? 'border-red-500/30 bg-red-500/[0.04]'
        : tone === 'changed'
          ? 'border-amber-500/30 bg-amber-500/[0.04]'
          : 'border-zinc-800 bg-zinc-900/60'
  return <div className={cn('rounded-md border px-3 py-2.5', cls)}>{children}</div>
}

function SessionHeader({ session, badge }: { session: Session; badge?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-zinc-500">{fullDate(session.date)}</span>
      <span className="flex items-baseline gap-2 text-sm font-semibold">
        {session.title}
        {badge && <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{badge}</span>}
      </span>
    </div>
  )
}

function FieldRow({ field, old: oldValue, new: newValue }: MetaChange) {
  const disp = (v: unknown) => (field === 'date' && typeof v === 'string' ? fullDate(v) : fmt(v))
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-zinc-500">{field}:</span>
      <del className="text-red-400">{disp(oldValue)}</del>
      <span className="text-green-400">{disp(newValue)}</span>
    </span>
  )
}

function ExRow({ ex, tone }: { ex: Exercise; tone: 'add' | 'del' | 'ctx' }) {
  return (
    <div
      className={cn(
        'flex items-baseline gap-2 rounded px-2 py-1 text-sm',
        tone === 'add'
          ? 'bg-green-500/10 text-green-300'
          : tone === 'del'
            ? 'bg-red-500/10 text-red-300'
            : 'text-zinc-400',
      )}
    >
      <span className="w-4 shrink-0 select-none">{tone === 'add' ? '+' : tone === 'del' ? '−' : ''}</span>
      <span className="font-medium">{ex.name}</span>
      {ex.coachNote && <CoachCue note={ex.coachNote} />}
      <span className="text-inherit opacity-80">{exLine(ex)}</span>
    </div>
  )
}

function ChangedExRow({ name, changes }: { name: string; changes: MetaChange[] }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded bg-amber-500/10 px-2 py-1 text-sm text-zinc-200">
      <span className="w-4 shrink-0 select-none text-amber-400">~</span>
      <span className="font-medium">{name}</span>
      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        {changes.map((c) => (
          <FieldRow key={c.field} field={c.field} old={c.old} new={c.new} />
        ))}
      </span>
    </div>
  )
}

function NewProgramBlock({ doc }: { doc: ProgramDocument }) {
  const weeks = new Map<number, Session[]>()
  for (const s of doc.sessions) {
    if (!weeks.has(s.week)) weeks.set(s.week, [])
    weeks.get(s.week)!.push(s)
  }
  return (
    <div className="space-y-3">
      {[...weeks.entries()].map(([week, sessions]) => (
        <div key={week}>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Week {week}</div>
          <div className="grid gap-px overflow-hidden rounded-md border border-green-500/30 bg-green-500/30 md:grid-cols-3">
            {sessions.map((s) => (
              <div key={s.date} className="bg-green-500/10 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs text-green-400/80">{fullDate(s.date)}</span>
                  <span className="text-sm font-semibold text-green-300">{s.title}</span>
                </div>
                <div className="mt-2 space-y-1">
                  {s.exercises.map((ex, i) => (
                    <div key={i} className="border-t border-green-500/20 py-1 text-sm text-green-300 first:border-0">
                      <span className="font-medium">{ex.name}</span>
                      {ex.coachNote && <CoachCue note={ex.coachNote} />}{' '}
                      <span className="text-green-400/70">{exLine(ex)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function SessionChangeView({ change }: { change: SessionChange }) {
  if (change.kind === 'added') {
    return (
      <ToneBlock tone="add">
        <SessionHeader session={change.session} badge="new" />
        <div className="mt-2 space-y-1">
          {change.session.exercises.map((ex, i) => (
            <ExRow key={i} ex={ex} tone="add" />
          ))}
        </div>
      </ToneBlock>
    )
  }
  if (change.kind === 'removed') {
    return (
      <ToneBlock tone="del">
        <SessionHeader session={change.session} badge="removed" />
        <div className="mt-2 space-y-1">
          {change.session.exercises.map((ex, i) => (
            <ExRow key={i} ex={ex} tone="del" />
          ))}
        </div>
      </ToneBlock>
    )
  }
  return (
    <ToneBlock tone={change.fields.length > 0 || change.exercises.some((e) => e.kind !== 'same') ? 'changed' : 'ctx'}>
      <SessionHeader session={change.session} />
      {change.fields.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
          {change.fields.map((f) => (
            <FieldRow key={f.field} field={f.field} old={f.old} new={f.new} />
          ))}
        </div>
      )}
      <div className="mt-2 space-y-1">
        {change.exercises.map((e) => {
          if (e.kind === 'added') return <ExRow key={e.exercise.name} ex={e.exercise} tone="add" />
          if (e.kind === 'removed') return <ExRow key={e.exercise.name} ex={e.exercise} tone="del" />
          if (e.kind === 'changed') return <ChangedExRow key={e.name} name={e.name} changes={e.changes} />
          return <ExRow key={e.exercise.name} ex={e.exercise} tone="ctx" />
        })}
      </div>
    </ToneBlock>
  )
}

export function ProgramDiff({ oldDoc, newDoc }: Props) {
  if (!oldDoc) {
    return (
      <div>
        <p className="mb-3 text-sm font-medium text-green-400">
          New program — {newDoc.sessions.length} sessions, {newDoc.weeks} weeks
        </p>
        <NewProgramBlock doc={newDoc} />
      </div>
    )
  }

  const { meta, weeks } = buildChanges(oldDoc, newDoc)

  if (meta.length === 0 && weeks.length === 0) {
    return <p className="text-sm text-zinc-500">No changes.</p>
  }

  return (
    <div className="space-y-4">
      {meta.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
          {meta.map((c) => (
            <FieldRow key={c.field} field={c.field} old={c.old} new={c.new} />
          ))}
        </div>
      )}
      {weeks.map((w) => (
        <div key={w.week}>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Week {w.week}</div>
          <div className="space-y-2">
            {w.sessions.map((change) => (
              <SessionChangeView key={change.session.date} change={change} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

interface ScheduleProps {
  doc: ProgramDocument
  oldDoc: ProgramDocument | null
  showDiff: boolean
}

function ExerciseRow({ exercise, change }: { exercise: Exercise; change: ExChange | null }) {
  const tone = !change ? 'none' : change.kind === 'added' ? 'add' : change.kind === 'removed' ? 'del' : 'changed'
  const rowBg =
    tone === 'add' ? 'bg-green-500/10 text-green-300' : tone === 'del' ? 'bg-red-500/10 text-red-300' : tone === 'changed' ? 'bg-amber-500/10' : ''
  return (
    <div className={cn('border-t border-zinc-800 py-1.5 first:border-0', rowBg)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn('text-sm', tone === 'none' ? 'text-zinc-100' : 'text-inherit')}>
          {exercise.name}
          {exercise.coachNote && <CoachCue note={exercise.coachNote} />}
        </span>
        <span className="shrink-0 text-xs font-medium text-zinc-300">
          {exercise.sets}&times;{exercise.reps}
          {exercise.intensity && <span className="text-zinc-400"> @ {exercise.intensity}</span>}
        </span>
      </div>
      {tone === 'changed' && change?.kind === 'changed' && (
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-amber-300">
          {change.changes.map((c) => (
            <FieldRow key={c.field} field={c.field} old={c.old} new={c.new} />
          ))}
        </div>
      )}
      {tone === 'none' && exercise.supersetWith && (
        <div className="mt-0.5 text-xs text-zinc-500">superset with {exercise.supersetWith}</div>
      )}
      {tone === 'none' && exercise.notes && <div className="mt-0.5 text-xs text-zinc-400">{exercise.notes}</div>}
    </div>
  )
}

function exChangeFor(change: SessionChange | null, name: string): ExChange | null {
  if (!change) return null
  if (change.kind === 'added') {
    const exercise = change.session.exercises.find((e) => e.name === name)
    return exercise ? { kind: 'added', exercise } : null
  }
  if (change.kind === 'removed') {
    const exercise = change.session.exercises.find((e) => e.name === name)
    return exercise ? { kind: 'removed', exercise } : null
  }
  return change.exercises.find((e) => (e.kind === 'changed' ? e.name : e.exercise.name) === name) ?? null
}

function SessionCell({ session, change, showDiff }: { session: Session; change: SessionChange | null; showDiff: boolean }) {
  const isChange = showDiff && change !== null && realChange(change)
  const tone = !isChange ? 'none' : change!.kind === 'added' ? 'add' : change!.kind === 'removed' ? 'del' : 'changed'
  const dateChange = change?.kind === 'changed' ? change.fields.find((f) => f.field === 'date') : null
  return (
    <div className={cn('p-4', tone === 'add' ? 'bg-green-500/10' : tone === 'del' ? 'bg-red-500/10' : 'bg-zinc-900')}>
      {dateChange ? (
        <div className="text-xs text-amber-300">
          <del className="text-red-400">{fullDate(String(dateChange.old))}</del> &rarr; {fullDate(String(dateChange.new))}
        </div>
      ) : (
        <div className="text-xs text-zinc-500">{fullDate(session.date)}</div>
      )}
      <div
        className={cn(
          'mt-0.5 text-sm font-semibold',
          tone === 'add' && 'text-green-300',
          tone === 'del' && 'text-red-300 line-through',
        )}
      >
        {session.title}
      </div>
      {session.focus && <div className="mt-0.5 text-xs text-zinc-500">{session.focus}</div>}
      {change?.kind === 'changed' && change.fields.some((f) => f.field !== 'date') && (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-amber-300">
          {change.fields
            .filter((f) => f.field !== 'date')
            .map((f) => (
              <FieldRow key={f.field} field={f.field} old={f.old} new={f.new} />
            ))}
        </div>
      )}
      {!showDiff && session.notes && <div className="mt-1 text-xs text-zinc-400">{session.notes}</div>}
      <div className="mt-3">
        {session.exercises.map((ex, i) => (
          <ExerciseRow key={i} exercise={ex} change={showDiff ? exChangeFor(change, ex.name) : null} />
        ))}
      </div>
    </div>
  )
}

export function Schedule({ doc, oldDoc, showDiff }: ScheduleProps) {
  const withChange: { session: Session; change: SessionChange | null }[] = []
  if (showDiff) {
    for (const change of matchSessions(oldDoc?.sessions ?? [], doc.sessions)) {
      withChange.push({ session: change.session, change })
    }
  } else {
    for (const s of oldDoc?.sessions ?? doc.sessions) {
      withChange.push({ session: s, change: null })
    }
  }

  const weeks = new Map<number, { session: Session; change: SessionChange | null }[]>()
  for (const cell of withChange) {
    if (!weeks.has(cell.session.week)) weeks.set(cell.session.week, [])
    weeks.get(cell.session.week)!.push(cell)
  }

  const sorted = [...weeks.entries()].sort((a, b) => a[0] - b[0])
  const meta = showDiff && oldDoc ? META_FIELDS.map((f) => ({ field: f, old: oldDoc[f], new: doc[f] })).filter((c) => c.old !== c.new) : []

  return (
    <>
      {meta.length > 0 && (
        <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-amber-300">
          {meta.map((c) => (
            <FieldRow key={c.field} field={c.field} old={c.old} new={c.new} />
          ))}
        </div>
      )}
      {sorted.map(([week, cells]) => (
        <Card key={week} className="mb-4">
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
            <span className="text-sm font-semibold">Week {week}</span>
            <span className="text-xs text-zinc-500">
              {cells[0].session.date} &rarr; {cells[cells.length - 1].session.date}
            </span>
          </div>
          <div className="grid gap-px bg-zinc-800 md:grid-cols-3">
            {cells.map((c, i) => (
              <SessionCell key={`${c.session.week}-${i}`} session={c.session} change={c.change} showDiff={showDiff} />
            ))}
          </div>
        </Card>
      ))}
    </>
  )
}

const META_FIELDS = ['name', 'goal', 'startDate', 'weeks', 'notes'] as const
