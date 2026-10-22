import { useMemo, useState } from 'react'
import type { ProgramResponse, VideoItem, VideosResponse } from '../shared/api'
import { apiPost, endpoints, useFetch } from './api'
import { Card, Loaded, Muted, PageTitle, cn } from './components'
import { Link } from './router'
import { isUnlabelled, VideoPlayerModal } from './videos-ui'
import { formatLongDate } from './format'

/** Temporary coach tool: fill in labels for imported clips. */
export function LabelPage() {
  const videos = useFetch<VideosResponse>(endpoints.videos)
  const program = useFetch<ProgramResponse>(endpoints.program)
  const [onlyUnlabelled, setOnlyUnlabelled] = useState(true)
  const [playing, setPlaying] = useState<VideoItem | null>(null)

  const exercises = useMemo(() => {
    const names = new Set<string>()
    for (const s of program.data?.sessions ?? []) for (const e of s.exercises) names.add(e.name)
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [program.data])

  return (
    <>
      <header className="flex items-start justify-between gap-3">
        <div>
          <PageTitle>Label videos</PageTitle>
          <Muted className="mt-1">Temporary tool — save each clip as you go.</Muted>
        </div>
        <Link to="/videos" className="mt-1 shrink-0 text-xs text-zinc-400 underline underline-offset-2">
          Videos
        </Link>
      </header>

      <Loaded state={videos}>
        {(data) => {
          const remaining = data.videos.filter(isUnlabelled).length
          const shown = onlyUnlabelled ? data.videos.filter(isUnlabelled) : data.videos
          return (
            <>
              <div className="flex items-center justify-between px-1">
                <p className="text-sm text-zinc-300">{remaining} unlabelled</p>
                <button
                  type="button"
                  onClick={() => setOnlyUnlabelled((v) => !v)}
                  className={cn(
                    'cursor-pointer rounded-full border px-3 py-1 text-xs font-medium',
                    onlyUnlabelled
                      ? 'border-zinc-100 bg-zinc-100 text-zinc-900'
                      : 'border-zinc-700 text-zinc-300 hover:border-zinc-500',
                  )}
                >
                  {onlyUnlabelled ? 'Showing unlabelled' : 'Showing all'}
                </button>
              </div>

              {shown.length === 0 && (
                <Card>
                  <Muted>Nothing left to label.</Muted>
                </Card>
              )}

              {shown.map((video) => (
                <LabelCard
                  key={video.id}
                  video={video}
                  exercises={exercises}
                  onPlay={() => setPlaying(video)}
                  onSaved={() => videos.reload()}
                />
              ))}
            </>
          )
        }}
      </Loaded>

      {playing && <VideoPlayerModal video={playing} onClose={() => setPlaying(null)} />}
    </>
  )
}

function LabelCard({
  video,
  exercises,
  onPlay,
  onSaved,
}: {
  video: VideoItem
  exercises: string[]
  onPlay: () => void
  onSaved: () => void
}) {
  const [exercise, setExercise] = useState(video.exercise === 'Unlabelled' ? '' : video.exercise)
  const [weight, setWeight] = useState(video.weight === null ? '' : String(video.weight))
  const [sets, setSets] = useState(video.sets === null ? '' : String(video.sets))
  const [reps, setReps] = useState(video.reps ?? '')
  const [date, setDate] = useState(video.date)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSave = exercise.trim().length > 0 && !saving

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await apiPost(`/api/videos/${encodeURIComponent(video.id)}/label`, {
        exercise: exercise.trim(),
        weight: weight.trim() === '' ? null : Number(weight),
        sets: sets.trim() === '' ? null : Number(sets),
        reps: reps.trim() === '' ? null : reps.trim(),
        date,
      })
      setSaved(true)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onPlay}
          className="relative h-16 w-24 shrink-0 cursor-pointer overflow-hidden rounded-md bg-zinc-950"
          aria-label={`Play ${video.exercise} on ${video.date}`}
        >
          <img src={video.posterUrl} alt="" className="h-full w-full object-cover" />
          <span className="absolute inset-0 grid place-items-center">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-black/60 text-[10px] text-white">▶</span>
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-100">{formatLongDate(video.date)}</p>
          <p className="mt-0.5 text-xs text-zinc-400">{video.exercise}</p>
          {saved && <p className="mt-1 text-xs font-medium text-emerald-400">Saved</p>}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="col-span-2 block">
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">Exercise</span>
          <input
            list={`ex-${video.id}`}
            value={exercise}
            onChange={(e) => {
              setExercise(e.target.value)
              setSaved(false)
            }}
            placeholder="e.g. High Bar Back Squat"
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-400 focus:outline-none"
          />
          <datalist id={`ex-${video.id}`}>
            {exercises.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>

        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">Weight (lb)</span>
          <input
            inputMode="decimal"
            value={weight}
            onChange={(e) => {
              setWeight(e.target.value)
              setSaved(false)
            }}
            placeholder="—"
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm tabular-nums text-zinc-100 focus:border-zinc-400 focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
              setSaved(false)
            }}
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 focus:border-zinc-400 focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">Sets</span>
          <input
            inputMode="numeric"
            value={sets}
            onChange={(e) => {
              setSets(e.target.value)
              setSaved(false)
            }}
            placeholder="—"
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm tabular-nums text-zinc-100 focus:border-zinc-400 focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">Reps</span>
          <input
            value={reps}
            onChange={(e) => {
              setReps(e.target.value)
              setSaved(false)
            }}
            placeholder="e.g. 5"
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 focus:border-zinc-400 focus:outline-none"
          />
        </label>
      </div>

      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}

      <button
        type="button"
        onClick={save}
        disabled={!canSave}
        className="mt-3 w-full cursor-pointer rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saving ? 'Saving…' : saved ? 'Saved' : 'Save labels'}
      </button>
    </Card>
  )
}
