import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ExerciseProgress, ProgressResponse } from '../shared/api'
import { endpoints, useFetch } from './api'
import { Card, Loaded, Muted, PageTitle } from './components'
import { formatChange, formatShortDate, formatWeight, pluralize } from './format'

export function ProgressPage() {
  const state = useFetch<ProgressResponse>(endpoints.progress)
  return (
    <Loaded state={state}>
      {(progress) => (
        <>
          <header>
            <PageTitle>Progress</PageTitle>
            <p className="mt-1 text-sm text-zinc-300">
              {pluralize(progress.completedWorkouts, 'completed workout')}
            </p>
            <Muted className="mt-2">
              Weights below are <span className="font-medium text-zinc-300">Programmed</span> (the prescribed load
              from your plan), not logged lifts.
            </Muted>
          </header>

          {progress.exercises.length === 0 && <Muted>No exercises yet.</Muted>}
          {progress.exercises.map((ex) => (
            <ExerciseCard key={ex.name} ex={ex} />
          ))}
        </>
      )}
    </Loaded>
  )
}

function ExerciseCard({ ex }: { ex: ExerciseProgress }) {
  const data = ex.points.map((p) => ({ label: formatShortDate(p.date), date: p.date, weight: p.weight }))
  const noneCompleted = ex.points.length === 0
  return (
    <Card>
      <h2 className="font-medium text-zinc-100">{ex.name}</h2>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="First" value={formatWeight(ex.firstWeight)} />
        <Stat label="Current" value={formatWeight(ex.currentWeight)} />
        <Stat label="Change" value={formatChange(ex.change)} emphasis />
      </div>
      {noneCompleted && (
        <Muted className="mt-2 text-xs">No completed sessions yet. Current shows the next scheduled weight.</Muted>
      )}

      {!noneCompleted && (
        <div className="mt-4">
          <p className="mb-1 text-xs text-zinc-500">Programmed weight (lb)</p>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#a1a1aa', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#3f3f46' }} minTickGap={16} />
                <YAxis
                  domain={['dataMin - 5', 'dataMax + 5']}
                  tick={{ fill: '#a1a1aa', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                />
                <Tooltip
                  contentStyle={{ background: '#09090b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#d4d4d8' }}
                  itemStyle={{ color: '#fafafa' }}
                  formatter={(value) => [formatWeight(Number(value)), 'Programmed']}
                />
                <Line
                  type="monotone"
                  dataKey="weight"
                  name="Programmed"
                  stroke="#fafafa"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#fafafa' }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </Card>
  )
}

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="rounded-lg bg-zinc-950/60 px-2 py-2">
      <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={emphasis ? 'mt-0.5 text-sm font-semibold text-zinc-50' : 'mt-0.5 text-sm font-medium text-zinc-100'}>
        {value}
      </p>
    </div>
  )
}
