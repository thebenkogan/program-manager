import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProgramResponse, VideoItem, VideosResponse } from '../shared/api'
import { apiPost, endpoints, useFetch } from './api'
import { Card, Loaded, Muted, PageTitle, cn } from './components'
import { Link } from './router'
import { formatLongDate, formatShotTime } from './format'
import { VideoPlayerModal } from './videos-ui'

const CHUNK = 8 * 1024 * 1024
/** Chunks in flight at once. 8 x 8 MB = 64 MB of the file in flight. */
const CONCURRENCY = 8
const MAX_RETRIES = 3
/** Speed averaging window: long enough to smooth 8 MB chunk bursts, short enough to react. */
const SPEED_WINDOW_MS = 5000

type Phase = 'waiting' | 'uploading' | 'finishing' | 'uploaded' | 'error'

interface QueueItem {
  key: string
  file: File
  phase: Phase
  /** Bytes the server has acknowledged. */
  sent: number
  startedAt: number | null
  finishedAt: number | null
  error?: string
  videoId?: string
}

/** A chunk acknowledgement, used to measure throughput over a rolling window. */
interface Sample {
  t: number
  b: number
}

interface BatchSummary {
  count: number
  bytes: number
  seconds: number
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}

function mbps(bytesPerSecond: number): string {
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`
}

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`
  return `${Math.floor(seconds / 60)}m ${String(Math.round(seconds % 60)).padStart(2, '0')}s`
}

function speedOf(item: QueueItem, samples: Map<string, Sample[]>): number {
  if (item.phase !== 'uploading' || item.startedAt === null || item.sent === 0) return 0
  const now = performance.now()
  const list = (samples.get(item.key) ?? []).filter((s) => now - s.t <= SPEED_WINDOW_MS)
  const first = list[0]
  const last = list[list.length - 1]
  if (first && last) {
    const span = (last.t - first.t) / 1000
    if (span >= 0.5) return (last.b - first.b) / span
  }
  // Not enough of a window yet (or chunks are still landing): average since start.
  const elapsed = (now - item.startedAt) / 1000
  return elapsed > 0.4 ? item.sent / elapsed : 0
}

/** Upload + label. Clips publish on their own as soon as encoding finishes. */
export function UploadPage() {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [busy, setBusy] = useState(false)
  const [batch, setBatch] = useState<BatchSummary | null>(null)
  const [limit, setLimit] = useState(24)
  const [playing, setPlaying] = useState<VideoItem | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const samples = useRef(new Map<string, Sample[]>())
  const batchTimer = useRef<number | null>(null)
  const drafts = useFetch<VideosResponse>(`${endpoints.videos}?status=all`)
  const program = useFetch<ProgramResponse>(endpoints.program)

  // Chunk acknowledgements only arrive every 8 MB, so tick the clock while
  // uploading to keep MB/s and the ETA moving between acknowledges.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => setTick((n) => n + 1), 500)
    return () => clearInterval(timer)
  }, [busy])

  useEffect(() => {
    return () => {
      if (batchTimer.current) window.clearTimeout(batchTimer.current)
    }
  }, [])

  const exercises = useMemo(() => {
    const names = new Set<string>()
    for (const s of program.data?.sessions ?? []) for (const e of s.exercises) names.add(e.name)
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [program.data])

  const pending = (drafts.data?.videos ?? []).filter((v) => v.status !== 'published')
  const encoding = pending.some((v) => v.status === 'processing')

  const totalBytes = queue.reduce((sum, i) => sum + i.file.size, 0)
  const sentBytes = queue.reduce((sum, i) => sum + i.sent, 0)
  const speed = queue.reduce((sum, i) => sum + speedOf(i, samples.current), 0)
  const remainingSeconds = speed > 0 ? (totalBytes - sentBytes) / speed : 0

  // Transcodes finish on the server in under a couple of minutes. Poll while any
  // clip is still encoding so the card disappears (published) on its own instead
  // of waiting for a manual refresh.
  const refreshDrafts = drafts.refresh
  useEffect(() => {
    if (!encoding) return
    const timer = setInterval(refreshDrafts, 4000)
    return () => clearInterval(timer)
  }, [encoding, refreshDrafts])

  const duplicateGroups = useMemo(() => {
    const map = new Map<string, VideoItem[]>()
    for (const v of drafts.data?.videos ?? []) {
      if (v.exercise === 'Unlabelled') continue
      const key = `${v.date}|${v.exercise}`
      const list = map.get(key)
      if (list) list.push(v)
      else map.set(key, [v])
    }
    return [...map.entries()].filter(([, list]) => list.length > 1)
  }, [drafts.data])

  const uploadOne = useCallback(
    async (file: File, key: string): Promise<boolean> => {
      const set = (patch: Partial<QueueItem>) =>
        setQueue((items) => items.map((i) => (i.key === key ? { ...i, ...patch } : i)))
      const startedAt = performance.now()
      samples.current.set(key, [{ t: startedAt, b: 0 }])
      set({ phase: 'uploading', startedAt })
      try {
        const created = await apiPost<{ uploadId: string }>('/api/uploads', {
          filename: file.name,
          size: file.size,
        })

        // Chunks run in parallel. The server writes each at its own offset and
        // tracks received ranges, so order does not matter and a retried chunk is
        // harmless. Progress counts bytes the server acknowledged.
        const offsets: number[] = []
        for (let offset = 0; offset < file.size; offset += CHUNK) offsets.push(offset)
        let acknowledged = 0
        let nextOffset = 0
        const send = async (offset: number) => {
          const end = Math.min(offset + CHUNK, file.size)
          for (let attempt = 0; ; attempt++) {
            let res: Response
            try {
              res = await fetch(`/api/uploads/${created.uploadId}/chunk?offset=${offset}`, {
                method: 'PUT',
                body: file.slice(offset, end),
                credentials: 'same-origin',
              })
            } catch (error) {
              // Network blip: back off and retry the same chunk (writes are idempotent).
              if (attempt >= MAX_RETRIES) throw error
              await new Promise((r) => setTimeout(r, 300 * 2 ** attempt))
              continue
            }
            if (res.ok) break
            const body = (await res.json().catch(() => ({}))) as { error?: string }
            // 5xx is worth retrying; 4xx means the request itself is wrong.
            if (res.status >= 500 && attempt < MAX_RETRIES) {
              await new Promise((r) => setTimeout(r, 300 * 2 ** attempt))
              continue
            }
            throw new Error(body.error ?? `chunk ${res.status}`)
          }
          acknowledged += end - offset
          const list = samples.current.get(key) ?? []
          list.push({ t: performance.now(), b: acknowledged })
          // Keep the window small; twenty samples is plenty for any chunk count.
          if (list.length > 20) list.splice(0, list.length - 20)
          samples.current.set(key, list)
          set({ sent: acknowledged })
        }
        const worker = async () => {
          while (nextOffset < offsets.length) {
            const offset = offsets[nextOffset++]
            await send(offset)
          }
        }
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, offsets.length) }, worker))

        // Last byte is in. Hashing, probing and the poster run in `complete()`,
        // which can take a few seconds on a 4K clip — say so instead of sitting on 100%.
        set({ phase: 'finishing', sent: file.size })

        const done = await fetch(`/api/uploads/${created.uploadId}/complete`, {
          method: 'POST',
          credentials: 'same-origin',
        })
        const body = (await done.json().catch(() => ({}))) as { videoId?: string; error?: string }
        if (done.status === 409 && body.error === 'duplicate') throw new Error('This clip is already in your library')
        if (!done.ok || !body.videoId) throw new Error(body.error ?? 'could not finish upload')
        set({ phase: 'uploaded', sent: file.size, videoId: body.videoId, finishedAt: Date.now() })
        drafts.reload()
        return true
      } catch (error) {
        set({ phase: 'error', error: error instanceof Error ? error.message : 'upload failed' })
        return false
      }
    },
    [drafts],
  )

  async function start(files: FileList | null) {
    if (!files || files.length === 0) return
    if (batchTimer.current) {
      window.clearTimeout(batchTimer.current)
      batchTimer.current = null
    }
    setBatch(null)
    const items = [...files].map((file) => ({
      key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      file,
      phase: 'waiting' as const,
      sent: 0,
      startedAt: null,
      finishedAt: null,
    }))
    samples.current.clear()
    setQueue(items)
    setBusy(true)
    const began = performance.now()
    let count = 0
    let bytes = 0
    for (const item of items) {
      if (await uploadOne(item.file, item.key)) {
        count += 1
        bytes += item.file.size
      }
    }
    setBusy(false)
    drafts.reload()
    // Keep failed rows on screen; the successful ones collapse into a summary.
    setQueue((current) => current.filter((i) => i.phase === 'error'))
    if (count > 0) {
      setBatch({ count, bytes, seconds: (performance.now() - began) / 1000 })
      batchTimer.current = window.setTimeout(() => setBatch(null), 12000)
    }
  }

  async function discard(video: VideoItem) {
    if (!window.confirm(`Delete this draft permanently?\n\n${video.exercise} · ${formatLongDate(video.date)}`)) return
    await fetch(`/api/videos/${video.id}`, { method: 'DELETE', credentials: 'same-origin' })
    drafts.reload()
  }

  /** Keep one clip from a duplicate group: delete the rest, then publish the keeper. */
  async function keepOnly(video: VideoItem, group: VideoItem[]) {
    if (
      !window.confirm(
        `Keep this clip and permanently delete the other ${group.length - 1}?\n\n${video.exercise} · ${formatLongDate(video.date)}`,
      )
    )
      return
    setBusy(true)
    try {
      for (const other of group) {
        if (other.id === video.id) continue
        const res = await fetch(`/api/videos/${other.id}`, { method: 'DELETE', credentials: 'same-origin' })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `delete failed (${res.status})`)
        }
      }
      if (video.status !== 'published') {
        await apiPost(`/api/videos/${video.id}/publish`, {})
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not resolve this duplicate')
    } finally {
      setBusy(false)
      drafts.reload()
    }
  }

  return (
    <>
      <header>
        <PageTitle>Upload</PageTitle>
        <Muted className="mt-1">Pick clips and label them. Each one publishes as soon as it finishes encoding.</Muted>
      </header>

      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void start(e.target.files)
          e.target.value = ''
        }}
      />

      {!batch && queue.length === 0 && pending.length === 0 ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full cursor-pointer rounded-xl border border-dashed border-zinc-700 bg-zinc-900/40 px-4 py-10 text-center hover:border-zinc-500"
        >
          <span className="block text-sm font-medium text-zinc-100">Choose videos</span>
          <span className="mt-1 block text-xs text-zinc-500">Select one or several from your camera roll</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="w-full cursor-pointer rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
        >
          Add more videos
        </button>
      )}

      {queue.length > 0 && (
        <>
          {busy && (
            <div className="flex items-baseline justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-xs text-zinc-400">
              <span>
                <span className="font-semibold text-zinc-100">
                  {queue.length} {queue.length === 1 ? 'clip' : 'clips'}
                </span>{' '}
                · {mb(totalBytes)} MB
              </span>
              <span className="tabular-nums">
                {speed > 0 ? (
                  <>
                    <span className="font-semibold text-zinc-100">{mbps(speed)}</span> · ~
                    {formatSeconds(remainingSeconds)} left
                  </>
                ) : (
                  'starting…'
                )}
              </span>
            </div>
          )}
          <Card flush>
            <div className="divide-y divide-zinc-800/70 px-3">
              {queue.map((item) => {
                const pct =
                  item.phase === 'waiting' || item.phase === 'uploading'
                    ? item.file.size > 0
                      ? Math.round((item.sent / item.file.size) * 100)
                      : 0
                    : 100
                const itemSpeed = speedOf(item, samples.current)
                const elapsed =
                  item.startedAt !== null && item.finishedAt !== null
                    ? (item.finishedAt - item.startedAt) / 1000
                    : 0
                return (
                  <div key={item.key} className="py-2">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate text-zinc-200">{item.file.name}</span>
                      <span className="shrink-0 text-xs tabular-nums text-zinc-400">
                        {item.phase === 'waiting' || item.phase === 'error'
                          ? `${mb(item.file.size)} MB`
                          : `${mb(item.sent)} / ${mb(item.file.size)} MB`}
                      </span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded bg-zinc-800">
                      <div
                        className={cn(
                          'h-full transition-[width] duration-300',
                          item.phase === 'error'
                            ? 'bg-red-500'
                            : item.phase === 'uploaded'
                              ? 'bg-emerald-400'
                              : item.phase === 'waiting'
                                ? 'bg-zinc-600'
                                : 'bg-zinc-100',
                          item.phase === 'finishing' && 'animate-pulse',
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between gap-2 text-[11px] tabular-nums text-zinc-500">
                      <span className="min-w-0 truncate">
                        {item.phase === 'waiting' && 'Waiting'}
                        {item.phase === 'uploading' &&
                          (itemSpeed > 0 ? (
                            <span className="font-medium text-zinc-300">{mbps(itemSpeed)}</span>
                          ) : (
                            'Starting…'
                          ))}
                        {item.phase === 'finishing' && 'Finishing upload…'}
                        {item.phase === 'uploaded' && (
                          <span className="font-medium text-emerald-400">Uploaded · encoding</span>
                        )}
                        {item.phase === 'error' && (
                          <span className="text-red-300">{item.error}</span>
                        )}
                      </span>
                      <span className="shrink-0">
                        {item.phase === 'uploading' &&
                          itemSpeed > 0 &&
                          `~${formatSeconds((item.file.size - item.sent) / itemSpeed)} left`}
                        {item.phase === 'uploaded' && formatSeconds(elapsed)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>
        </>
      )}

      {batch && (
        <Card>
          <p className="text-sm font-medium text-emerald-400">
            {batch.count === 1 ? 'Clip uploaded' : `${batch.count} clips uploaded`} — encoding now
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {mb(batch.bytes)} MB in {formatSeconds(batch.seconds)}. They appear in Videos when ready — label them
            there while they encode.
          </p>
          <p className="mt-2 text-sm">
            <Link to="/videos" className="font-medium text-zinc-200 underline underline-offset-2">
              View videos
            </Link>
          </p>
        </Card>
      )}

      <Loaded state={drafts}>
        {(data) => {
          const items = data.videos.filter((v) => v.status !== 'published')
          return (
            <>
              {duplicateGroups.length > 0 && (
                <Card>
                  <h2 className="text-sm font-medium text-zinc-100">Duplicates ({duplicateGroups.length})</h2>
                  <p className="mt-1 text-xs text-zinc-500">
                    Same exercise on the same day. Pick the clip to keep; the rest are permanently deleted.
                  </p>
                  <div className="mt-3 space-y-4">
                    {duplicateGroups.map(([key, group]) => (
                      <div key={key}>
                        <p className="text-xs font-medium text-zinc-300">
                          {group[0].exercise} · {formatLongDate(group[0].date)}
                        </p>
                        <div className="mt-1 space-y-1">
                          {group.map((video) => (
                            <div key={video.id} className="flex items-center gap-2 rounded-md bg-zinc-950/40 p-1.5">
                              <img src={video.posterUrl} alt="" loading="lazy" className="h-10 w-16 rounded object-cover" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs text-zinc-200">
                                  {video.status === 'published' ? 'Published' : 'Draft'} ·{' '}
                                  {video.weight !== null ? `${video.weight} lb` : 'no weight'}
                                  {video.sets !== null
                                    ? ` · ${video.sets === 1 ? `${video.reps ?? '?'} rep` : `${video.sets}×${video.reps ?? '?'}`}`
                                    : ''}
                                </p>
                                <p className="text-[10px] text-zinc-500">{video.id}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => keepOnly(video, group)}
                                disabled={busy}
                                className="shrink-0 cursor-pointer rounded bg-zinc-100 px-2 py-1 text-[11px] font-semibold text-zinc-900 disabled:opacity-40"
                              >
                                Keep
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {items.length > 0 && (
                <p className="px-1 text-sm text-zinc-300">
                  {items.length} still encoding or waiting on a duplicate
                </p>
              )}

              {items.length === 0 && queue.length === 0 && !batch && (
                <Card>
                  <Muted>No drafts — everything you uploaded is published.</Muted>
                  <p className="mt-2 text-sm">
                    <Link to="/videos" className="font-medium text-zinc-200 underline underline-offset-2">
                      View your videos
                    </Link>
                  </p>
                </Card>
              )}

              {items.slice(0, limit).map((video) => (
                <DraftCard
                  key={video.id}
                  video={video}
                  exercises={exercises}
                  onPlay={() => setPlaying(video)}
                  onSaved={() => drafts.reload()}
                  onDiscard={() => discard(video)}
                />
              ))}

              {items.length > limit && (
                <button
                  type="button"
                  onClick={() => setLimit((n) => n + 24)}
                  className="w-full cursor-pointer rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  Show {Math.min(24, items.length - limit)} more ({items.length - limit} left)
                </button>
              )}

              
            </>
          )
        }}
      </Loaded>

      {playing && <VideoPlayerModal video={playing} onClose={() => setPlaying(null)} />}

      <p className="px-1 text-center text-xs text-zinc-600">
        <Link to="/videos" className="underline underline-offset-2">
          Back to videos
        </Link>
      </p>
    </>
  )
}

function DraftCard({
  video,
  exercises,
  onPlay,
  onSaved,
  onDiscard,
}: {
  video: VideoItem
  exercises: string[]
  onPlay: () => void
  onSaved: () => void
  onDiscard: () => void
}) {
  const [exercise, setExercise] = useState(video.exercise === 'Unlabelled' ? '' : video.exercise)
  const [weight, setWeight] = useState(video.weight === null ? '' : String(video.weight))
  const [reps, setReps] = useState(video.reps ?? '')
  const [date, setDate] = useState(video.date)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const processing = video.status === 'processing'
  const failed = video.status === 'failed'

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await apiPost(`/api/videos/${video.id}/label`, {
        exercise: exercise.trim(),
        weight: weight.trim() === '' ? null : Number(weight),
        // One clip is one set, always.
        sets: 1,
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
          disabled={processing || failed}
          className="relative h-16 w-24 shrink-0 overflow-hidden rounded-md bg-zinc-950 disabled:cursor-default"
        >
          {!failed && (
            <img
              src={video.posterUrl}
              alt=""
              loading="lazy"
              className={cn('h-full w-full object-cover', processing && 'opacity-40')}
            />
          )}
          <span className="absolute inset-0 grid place-items-center">
            {processing ? (
              <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">Encoding…</span>
            ) : failed ? (
              <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">Failed</span>
            ) : (
              <span className="grid h-7 w-7 place-items-center rounded-full bg-black/60 text-[10px] text-white">▶</span>
            )}
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-100">
            {formatLongDate(video.date)}
            {video.shotAt ? ` · ${formatShotTime(video.shotAt)}` : ''}
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">
            {processing ? 'Encoding — labels can be set now' : failed ? 'Encoding failed' : video.exercise}
          </p>
          {saved && <p className="mt-1 text-xs font-medium text-emerald-400">Saved</p>}
        </div>
        {!processing && (
          <button
            type="button"
            onClick={onDiscard}
            className="h-fit cursor-pointer rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 hover:border-red-500/50 hover:text-red-300"
          >
            Delete
          </button>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="col-span-2 block">
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">Exercise</span>
          <input
            list={`up-${video.id}`}
            value={exercise}
            onChange={(e) => {
              setExercise(e.target.value)
              setSaved(false)
            }}
            placeholder="e.g. High Bar Back Squat"
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-400 focus:outline-none"
          />
          <datalist id={`up-${video.id}`}>
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
        disabled={saving || exercise.trim().length === 0}
        className="mt-3 w-full cursor-pointer rounded-md border border-zinc-600 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
      >
        {saving ? 'Saving…' : saved ? 'Saved' : 'Save labels'}
      </button>
    </Card>
  )
}
