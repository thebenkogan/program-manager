import { useMemo, useState, type ReactNode } from 'react'
import type { VideoItem, VideosResponse } from '../shared/api'
import { endpoints, useFetch } from './api'
import { Card, Loaded, Muted, PageTitle, cn } from './components'
import { Link } from './router'
import { VideoPlayerModal, VideoRow } from './videos-ui'

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function initialFilter(): string {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('exercise') ?? ''
}

export function VideosPage() {
  const state = useFetch<VideosResponse>(endpoints.videos)
  const [exercise, setExercise] = useState(initialFilter)
  const [playing, setPlaying] = useState<VideoItem | null>(null)

  return (
    <>
      <header>
        <PageTitle>Videos</PageTitle>
        <p className="mt-1 text-sm text-zinc-300">Every clip, newest first.</p>
        <Muted className="mt-2">
          <Link to="/progress" className="underline underline-offset-2 hover:text-zinc-200">
            Back to progress
          </Link>
          <span className="px-1.5 text-zinc-600">·</span>
          <Link to="/label" className="underline underline-offset-2 hover:text-zinc-200">
            Label clips
          </Link>
        </Muted>
      </header>

      <Loaded state={state}>
        {(data) => <VideoLibrary videos={data.videos} exercise={exercise} setExercise={setExercise} onPlay={setPlaying} />}
      </Loaded>

      {playing && <VideoPlayerModal video={playing} onClose={() => setPlaying(null)} />}
    </>
  )
}

function VideoLibrary({
  videos,
  exercise,
  setExercise,
  onPlay,
}: {
  videos: VideoItem[]
  exercise: string
  setExercise: (value: string) => void
  onPlay: (video: VideoItem) => void
}) {
  const exercises = useMemo(() => [...new Set(videos.map((v) => v.exercise))].sort((a, b) => a.localeCompare(b)), [videos])
  const filtered = exercise ? videos.filter((v) => v.exercise === exercise) : videos

  const groups = useMemo(() => {
    const map = new Map<string, VideoItem[]>()
    for (const v of filtered) {
      const key = v.date.slice(0, 7)
      const list = map.get(key)
      if (list) list.push(v)
      else map.set(key, [v])
    }
    return [...map.entries()]
  }, [filtered])

  function choose(value: string) {
    setExercise(value)
    const url = new URL(window.location.href)
    if (value) url.searchParams.set('exercise', value)
    else url.searchParams.delete('exercise')
    window.history.replaceState(null, '', url.pathname + (url.search || ''))
  }

  if (videos.length === 0) {
    return (
      <Card>
        <Muted>No videos yet.</Muted>
        <Muted className="mt-2 text-xs">
          Clips appear here once they are ingested. Each one is tagged with its exercise, date, weight and sets.
        </Muted>
      </Card>
    )
  }

  return (
    <>
      {exercises.length > 1 && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <FilterChip active={!exercise} onClick={() => choose('')}>
            All
          </FilterChip>
          {exercises.map((name) => (
            <FilterChip key={name} active={exercise === name} onClick={() => choose(name)}>
              {name}
            </FilterChip>
          ))}
        </div>
      )}

      {groups.map(([month, items]) => (
        <section key={month} className="space-y-2">
          <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-zinc-500">{monthLabel(month)}</h2>
          <Card flush>
            <div className="divide-y divide-zinc-800/70 px-2">
              {items.map((v) => (
                <VideoRow key={v.id} video={v} showExercise onPlay={() => onPlay(v)} />
              ))}
            </div>
          </Card>
        </section>
      ))}
    </>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 cursor-pointer whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium',
        active
          ? 'border-zinc-100 bg-zinc-100 text-zinc-900'
          : 'border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100',
      )}
    >
      {children}
    </button>
  )
}
