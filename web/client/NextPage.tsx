import type { Exercise, NextWorkoutResponse } from '../shared/api'
import { endpoints, useFetch } from './api'
import { Card, Loaded, Muted, PageTitle, cn } from './components'
import { formatDate, formatPrescription } from './format'
import { suggestWarmup } from '../shared/warmup'

export function NextPage() {
  const state = useFetch<NextWorkoutResponse>(endpoints.next)
  return (
    <Loaded state={state}>
      {({ programName, session }) => (
        <>
          <p className="text-xs uppercase tracking-wider text-zinc-500">{programName}</p>
          {!session ? (
            <Card>
              <PageTitle>No upcoming workouts</PageTitle>
              <Muted className="mt-2">Your coach will add the next session here.</Muted>
            </Card>
          ) : (
            <>
              <header>
                <PageTitle>{session.title}</PageTitle>
                <p className="mt-1 text-sm text-zinc-400">
                  {formatDate(session.date)} · Week {session.week}
                </p>
                {session.focus && <p className="mt-1 text-sm font-medium text-zinc-200">Focus: {session.focus}</p>}
                {session.notes && <Muted className="mt-2 whitespace-pre-line">{session.notes}</Muted>}
              </header>
              <Card flush>
                <ul className="divide-y divide-zinc-800">
                  {session.exercises.map((ex, i) => (
                    <ExerciseRow key={`${ex.name}-${i}`} ex={ex} showWarmup />
                  ))}
                </ul>
              </Card>
            </>
          )}
        </>
      )}
    </Loaded>
  )
}

export function ExerciseRow({ ex, showWarmup = false }: { ex: Exercise; showWarmup?: boolean }) {
  const warmup = showWarmup ? suggestWarmup(ex.name, ex.intensity) : []
  return (
    <li className="px-4 py-3.5">
      <p className="font-medium text-zinc-100">{ex.name}</p>
      <p className="mt-0.5 text-sm text-zinc-300">{formatPrescription(ex.sets, ex.reps, ex.intensity)}</p>
      {ex.backoff && <p className="mt-0.5 text-sm text-zinc-400">Back-off: {ex.backoff}</p>}
      {ex.supersetWith && <p className="mt-0.5 text-xs text-zinc-500">Superset with {ex.supersetWith}</p>}
      {warmup.length > 0 && (
        <div className="mt-2">
          <p className="text-[9.5px] font-medium uppercase tracking-[0.18em] text-zinc-600">Warm-up</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {warmup.map((set, j) => (
              <span
                key={`${set.weight}-${set.reps}-${j}`}
                className={cn(
                  'rounded-full border px-1.5 py-0.5 text-[11px] leading-4 tabular-nums',
                  j === 0
                    ? 'border-amber-500/25 bg-amber-500/10 text-amber-200/90'
                    : 'border-zinc-700/60 bg-zinc-800/40 text-zinc-400',
                )}
              >
                {set.weight}×{set.reps}
              </span>
            ))}
          </div>
        </div>
      )}
      {ex.notes && <p className="mt-1 whitespace-pre-line text-sm text-zinc-500">{ex.notes}</p>}
    </li>
  )
}
