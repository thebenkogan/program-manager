import type { Exercise, NextWorkoutResponse } from '../shared/api'
import { endpoints, useFetch } from './api'
import { Card, Loaded, Muted, PageTitle } from './components'
import { formatDate, formatPrescription } from './format'

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
                    <ExerciseRow key={`${ex.name}-${i}`} ex={ex} />
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

export function ExerciseRow({ ex }: { ex: Exercise }) {
  return (
    <li className="px-4 py-3.5">
      <p className="font-medium text-zinc-100">{ex.name}</p>
      <p className="mt-0.5 text-sm text-zinc-300">{formatPrescription(ex.sets, ex.reps, ex.intensity)}</p>
      {ex.backoff && <p className="mt-0.5 text-sm text-zinc-400">Back-off: {ex.backoff}</p>}
      {ex.supersetWith && <p className="mt-0.5 text-xs text-zinc-500">Superset with {ex.supersetWith}</p>}
      {ex.notes && <p className="mt-1 whitespace-pre-line text-sm text-zinc-500">{ex.notes}</p>}
    </li>
  )
}
