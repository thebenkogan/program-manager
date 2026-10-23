import { useEffect, useState, type ReactNode } from 'react'
import type { VideoItem } from '../shared/api'
import { cn } from './components'
import { formatLongDate } from './format'

export function formatDuration(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return ''
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function videoLabel(v: VideoItem): string {
  const parts: string[] = []
  if (v.weight !== null) parts.push(`${v.weight} lb`)
  if (v.sets !== null && v.reps) parts.push(`${v.sets}×${v.reps}`)
  else if (v.sets !== null) parts.push(`${v.sets} sets`)
  else if (v.reps) parts.push(`${v.reps} reps`)
  return parts.join(' · ')
}

export function isUnlabelled(v: VideoItem): boolean {
  return v.weight === null && v.sets === null && !v.reps
}

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'warn' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
        tone === 'warn' ? 'bg-amber-500/10 text-amber-300' : 'bg-zinc-800 text-zinc-300',
      )}
    >
      {children}
    </span>
  )
}

export function VideoRow({ video, onPlay, showExercise }: { video: VideoItem; onPlay: () => void; showExercise?: boolean }) {
  return (
    <button
      type="button"
      onClick={onPlay}
      className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-1 py-2 text-left hover:bg-zinc-800/50"
    >
      <span className="relative block h-14 w-24 shrink-0 overflow-hidden rounded-md bg-zinc-950">
        <img src={video.posterUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-black/60 text-[10px] text-white">▶</span>
        </span>
        {video.durationS ? (
          <span className="absolute bottom-0.5 right-1 rounded bg-black/70 px-1 text-[10px] tabular-nums text-white">
            {formatDuration(video.durationS)}
          </span>
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        {showExercise && <span className="block truncate text-sm font-medium text-zinc-100">{video.exercise}</span>}
        <span className={cn('block text-xs text-zinc-400', showExercise && 'mt-0.5')}>{formatLongDate(video.date)}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1">
          {isUnlabelled(video) ? <Badge tone="warn">Unlabelled</Badge> : <Badge>{videoLabel(video)}</Badge>}
          {video.setIndex !== null && <Badge>Set {video.setIndex}</Badge>}
        </span>
      </span>
    </button>
  )
}

export function VideoPlayerModal({
  video,
  onClose,
  onDeleted,
}: {
  video: VideoItem
  onClose: () => void
  onDeleted?: () => void
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    if (!window.confirm(`Delete this video permanently?\n\n${video.exercise} · ${formatLongDate(video.date)}`)) return
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(video.videoUrl, { method: 'DELETE', credentials: 'same-origin' })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `delete failed (${res.status})`)
      }
      onDeleted?.()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete')
    } finally {
      setDeleting(false)
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${video.exercise} video`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3"
      onClick={onClose}
    >
      <div className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-zinc-100">{video.exercise}</p>
            <p className="text-xs text-zinc-400">
              {formatLongDate(video.date)} · {isUnlabelled(video) ? 'Unlabelled' : videoLabel(video)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onDeleted && (
              <button
                type="button"
                onClick={remove}
                disabled={deleting}
                className="cursor-pointer rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:border-red-500/50 hover:text-red-300 disabled:opacity-40"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close video"
              className="cursor-pointer rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              Close
            </button>
          </div>
        </div>
        {error && <p className="mb-2 text-xs text-red-300">{error}</p>}
        <video
          src={video.videoUrl}
          poster={video.posterUrl}
          controls
          autoPlay
          playsInline
          preload="metadata"
          className="max-h-[75dvh] w-full rounded-xl bg-black"
        />
      </div>
    </div>
  )
}

export function VideoSheet({
  title,
  videos,
  onClose,
}: {
  title: string
  videos: VideoItem[]
  onClose: () => void
}) {
  const [playing, setPlaying] = useState<VideoItem | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60" onClick={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${title} videos`}
          className="max-h-[80dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border-t border-zinc-800 bg-zinc-900 p-4 pb-6"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider text-zinc-500">Videos</p>
              <p className="text-sm font-medium text-zinc-100">{title}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="cursor-pointer rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              Close
            </button>
          </div>
          {videos.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">No videos for this exercise yet.</p>
          ) : (
            <div className="divide-y divide-zinc-800/70">
              {videos.map((v) => (
                <VideoRow key={v.id} video={v} onPlay={() => setPlaying(v)} />
              ))}
            </div>
          )}
        </div>
      </div>
      {playing && <VideoPlayerModal video={playing} onClose={() => setPlaying(null)} />}
    </>
  )
}
