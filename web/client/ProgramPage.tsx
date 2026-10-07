import type { ProgramResponse, ProgramSessionView } from '../shared/api'
import { endpoints, useFetch } from './api'
import { Loaded, Muted, PageTitle, cn } from './components'
import { ExerciseRow } from './NextPage'
import { formatDate, formatLongDate, groupBy } from './format'

export function ProgramPage() {
  const state = useFetch<ProgramResponse>(endpoints.program)
  return (
    <Loaded state={state}>
      {(program) => {
        const weeks = groupBy(program.sessions, (s) => s.week)
        return (
          <>
            <header>
              <p className="text-xs uppercase tracking-wider text-zinc-500">Program</p>
              <PageTitle>{program.programName}</PageTitle>
              <Muted className="mt-1">
                {program.weeks} {program.weeks === 1 ? 'week' : 'weeks'} · starts {formatLongDate(program.startDate)}
              </Muted>
              {program.goal && <p className="mt-2 text-sm text-zinc-200">Goal: {program.goal}</p>}
              {program.notes && <Muted className="mt-2 whitespace-pre-line">{program.notes}</Muted>}
            </header>

            {program.sessions.length === 0 && <Muted>No sessions yet.</Muted>}

            {weeks.map((week) => (
              <section key={week.key} className="space-y-2">
                <h2 className="pt-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Week {week.key}</h2>
                {week.items.map((s, i) => (
                  <SessionCard
                    key={`${s.date}-${i}`}
                    session={s}
                    isNext={s.date === program.nextDate}
                  />
                ))}
              </section>
            ))}
          </>
        )
      }}
    </Loaded>
  )
}

function SessionCard({ session, isNext }: { session: ProgramSessionView; isNext: boolean }) {
  const done = session.status === 'done'
  return (
    <details
      open={isNext}
      className={cn(
        'group rounded-xl border bg-zinc-900/60 transition-colors',
        isNext ? 'border-zinc-400 ring-1 ring-zinc-400/40' : 'border-zinc-800',
        done && !isNext && 'opacity-60',
      )}
    >
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <p className="text-xs text-zinc-400">{formatDate(session.date)}</p>
          <p className={cn('mt-0.5 font-medium', done ? 'text-zinc-400' : 'text-zinc-100')}>{session.title}</p>
          {session.focus && <p className="mt-0.5 text-xs text-zinc-500">{session.focus}</p>}
        </div>
        <div className="shrink-0 text-right text-xs font-medium">
          {done && <span className="text-emerald-400">✓ Done</span>}
          {isNext && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-900">Next</span>}
        </div>
      </summary>
      <div className="border-t border-zinc-800">
        {session.notes && <p className="whitespace-pre-line px-4 pt-3 text-sm text-zinc-400">{session.notes}</p>}
        <ul className="divide-y divide-zinc-800">
          {session.exercises.map((ex, i) => (
            <ExerciseRow key={`${ex.name}-${i}`} ex={ex} />
          ))}
        </ul>
      </div>
    </details>
  )
}
