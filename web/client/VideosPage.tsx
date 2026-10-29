import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { VideoItem, VideosResponse } from '../shared/api'
import { endpoints, useFetch } from './api'
import { Card, Loaded, Muted, PageTitle, cn } from './components'
import { formatLongDate } from './format'
import { Link } from './router'
import { Badge, VideoPlayerModal, VideoRow } from './videos-ui'

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function initialFilter(): string {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('exercise') ?? ''
}

export function VideosPage() {
  const state = useFetch<VideosResponse>(`${endpoints.videos}?status=all`)
  const [exercise, setExercise] = useState(initialFilter)
  const [playing, setPlaying] = useState<VideoItem | null>(null)

  const all = state.data?.videos ?? []
  const published = all.filter((v) => v.status === 'published')
  const pending = all.filter((v) => v.status !== 'published')
  const encoding = pending.some((v) => v.status === 'processing')

  // A finished upload is visible before it publishes. Poll while anything is
  // still encoding so the placeholder turns into a real row on its own.
  const refresh = state.refresh
  useEffect(() => {
    if (!encoding) return
    const timer = setInterval(refresh, 4000)
    return () => clearInterval(timer)
  }, [encoding, refresh])

  return (
    <>
      <header>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <PageTitle>Videos</PageTitle>
            <p className="mt-1 text-sm text-zinc-300">Every clip, newest first.</p>
          </div>
          <Link
            to="/upload"
            className="mt-1 shrink-0 rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-white"
          >
            + Upload
          </Link>
        </div>
        <Muted className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link to="/progress" className="underline underline-offset-2 hover:text-zinc-200">
            Back to progress
          </Link>
          <span className="text-zinc-600">·</span>
          <Link to="/label" className="underline underline-offset-2 hover:text-zinc-200">
            Edit labels
          </Link>
        </Muted>
      </header>

      <Loaded state={state}>
        {() => (
          <>
            {pending.length > 0 && (
              <section className="space-y-2">
                <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-zinc-500">Not published yet</h2>
                <Card flush>
                  <div className="divide-y divide-zinc-800/70 px-2">
                    {pending.map((video) => (
                      <PendingVideoRow key={video.id} video={video} />
                    ))}
                  </div>
                </Card>
              </section>
            )}
            {published.length > 0 ? (
              <VideoLibrary videos={published} exercise={exercise} setExercise={setExercise} onPlay={setPlaying} />
            ) : (
              pending.length === 0 && (
                <Card>
                  <Muted>No videos yet.</Muted>
                  <Muted className="mt-2 text-xs">
                    Clips appear here once they are ingested. Each one is tagged with its exercise, date, weight and sets.
                  </Muted>
                </Card>
              )
            )}
          </>
        )}
      </Loaded>

      {playing && (
        <VideoPlayerModal video={playing} onClose={() => setPlaying(null)} onDeleted={() => state.reload()} />
      )}
    </>
  )
}

/** A clip that exists but is not published yet: encoding, failed, or a draft. */
function PendingVideoRow({ video }: { video: VideoItem }) {
  const processing = video.status === 'processing'
  const failed = video.status === 'failed'
  const detail = processing
    ? 'Publishes on its own when encoding finishes'
    : failed
      ? 'Encoding failed — re-upload it'
      : 'Same exercise and day as another clip — resolve it on Upload'
  return (
    <div className="flex items-center gap-3 px-1 py-2">
      <span className="grid h-14 w-24 shrink-0 place-items-center rounded-md border border-dashed border-zinc-700 bg-zinc-950">
        <span className={cn('text-[10px] font-medium', processing ? 'animate-pulse text-zinc-300' : 'text-zinc-500')}>
          {processing ? 'Encoding…' : failed ? 'Failed' : 'Draft'}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-zinc-300">
          {video.exercise === 'Unlabelled' ? 'Unlabelled clip' : video.exercise}
        </span>
        <span className="mt-0.5 block text-xs text-zinc-500">{formatLongDate(video.date)}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge tone="warn">{processing ? 'Encoding' : failed ? 'Failed' : 'Draft'}</Badge>
          <span className="text-[11px] text-zinc-500">{detail}</span>
        </span>
      </span>
      {!processing && (
        <Link to="/upload" className="shrink-0 text-[11px] text-zinc-400 underline underline-offset-2 hover:text-zinc-200">
          Upload
        </Link>
      )}
    </div>
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
