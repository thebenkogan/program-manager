import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProgramResponse, VideoItem, VideosResponse } from '../shared/api'
import { apiPost, endpoints, useFetch } from './api'
import { Card, Loaded, Muted, PageTitle, cn } from './components'
import { Link, navigate } from './router'
import { formatLongDate } from './format'
import { VideoPlayerModal } from './videos-ui'

const CHUNK = 8 * 1024 * 1024
/** Chunks in flight at once. 8 x 8 MB = 64 MB of the file in flight. */
const CONCURRENCY = 8
const MAX_RETRIES = 3

interface QueueItem {
  key: string
  file: File
  progress: number
  state: 'uploading' | 'done' | 'error'
  error?: string
  videoId?: string
}

/** Upload + label + publish. Chunks keep every request under Cloudflare's body cap. */
export function UploadPage() {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [busy, setBusy] = useState(false)
  const [limit, setLimit] = useState(24)
  const [playing, setPlaying] = useState<VideoItem | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const drafts = useFetch<VideosResponse>(`${endpoints.videos}?status=all`)
  const program = useFetch<ProgramResponse>(endpoints.program)

  const exercises = useMemo(() => {
    const names = new Set<string>()
    for (const s of program.data?.sessions ?? []) for (const e of s.exercises) names.add(e.name)
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [program.data])

  const pending = (drafts.data?.videos ?? []).filter((v) => v.status !== 'published')
  const encoding = pending.some((v) => v.status === 'processing')

  // Transcodes finish on the server in under a couple of minutes. Poll while any
  // clip is still encoding so the card flips to a publishable draft on its own
  // instead of waiting for a manual refresh.
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
    async (file: File, key: string) => {
      const set = (patch: Partial<QueueItem>) =>
        setQueue((items) => items.map((i) => (i.key === key ? { ...i, ...patch } : i)))
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
          set({ progress: Math.round((acknowledged / file.size) * 100) })
        }
        const worker = async () => {
          while (nextOffset < offsets.length) {
            const offset = offsets[nextOffset++]
            await send(offset)
          }
        }
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, offsets.length) }, worker))

        const done = await fetch(`/api/uploads/${created.uploadId}/complete`, {
          method: 'POST',
          credentials: 'same-origin',
        })
        const body = (await done.json().catch(() => ({}))) as { videoId?: string; error?: string }
        if (done.status === 409 && body.error === 'duplicate') throw new Error('This clip is already in your library')
        if (!done.ok || !body.videoId) throw new Error(body.error ?? 'could not finish upload')
        set({ state: 'done', progress: 100, videoId: body.videoId })
        drafts.reload()
      } catch (error) {
        set({ state: 'error', error: error instanceof Error ? error.message : 'upload failed' })
      }
    },
    [drafts],
  )

  async function start(files: FileList | null) {
    if (!files || files.length === 0) return
    const items = [...files].map((file) => ({
      key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      file,
      progress: 0,
      state: 'uploading' as const,
    }))
    setQueue(items)
    setBusy(true)
    for (const item of items) await uploadOne(item.file, item.key)
    setBusy(false)
    drafts.reload()
  }

  async function publishAll() {
    setBusy(true)
    const errors: string[] = []
    for (const video of pending.filter((v) => v.status === 'draft')) {
      try {
        await apiPost(`/api/videos/${video.id}/publish`, {})
      } catch (error) {
        errors.push(`${video.exercise} (${formatLongDate(video.date)}): ${(error as Error).message}`)
      }
    }
    setBusy(false)
    drafts.reload()
    if (errors.length === 0) navigate('/videos')
    else window.alert(`Some clips could not be published:\n\n${errors.join('\n')}`)
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
        <Muted className="mt-1">Pick clips, label them, then publish.</Muted>
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

      {queue.length === 0 && pending.length === 0 ? (
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
        <Card flush>
          <div className="divide-y divide-zinc-800/70 px-3">
            {queue.map((item) => (
              <div key={item.key} className="py-2">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-zinc-200">{item.file.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                    {item.state === 'error' ? 'failed' : `${item.progress}%`}
                  </span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded bg-zinc-800">
                  <div
                    className={cn('h-full', item.state === 'error' ? 'bg-red-500' : 'bg-zinc-100')}
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
                {item.error && <p className="mt-1 text-xs text-red-300">{item.error}</p>}
              </div>
            ))}
          </div>
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
                <div className="flex items-center justify-between px-1">
                  <p className="text-sm text-zinc-300">
                    {items.length} draft{items.length === 1 ? '' : 's'}
                  </p>
                  <button
                    type="button"
                    onClick={publishAll}
                    disabled={busy || !items.some((v) => v.status === 'draft')}
                    className="cursor-pointer rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-900 hover:bg-white disabled:opacity-40"
                  >
                    Publish all
                  </button>
                </div>
              )}

              {items.length === 0 && queue.length === 0 && (
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

              {items.length === 0 && queue.length > 0 && busy && <Muted className="text-center">Working…</Muted>}
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
  const [sets, setSets] = useState(video.sets === null ? '' : String(video.sets))
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
          disabled={processing || failed}
          className="relative h-16 w-24 shrink-0 overflow-hidden rounded-md bg-zinc-950 disabled:opacity-50"
        >
          {!processing && !failed && (
            <img src={video.posterUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
          )}
          <span className="absolute inset-0 grid place-items-center text-[10px] text-zinc-400">
            {processing ? 'Encoding…' : failed ? 'Failed' : '▶'}
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-100">{formatLongDate(video.date)}</p>
          <p className="mt-0.5 text-xs text-zinc-400">
            {processing ? 'Transcoding — labels can be set now' : failed ? 'Encoding failed' : video.exercise}
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
        disabled={saving || exercise.trim().length === 0}
        className="mt-3 w-full cursor-pointer rounded-md border border-zinc-600 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
      >
        {saving ? 'Saving…' : saved ? 'Saved' : 'Save labels'}
      </button>
    </Card>
  )
}
