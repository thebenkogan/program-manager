import { useEffect, useMemo, useState } from 'react'
import type { Client, CoachData, ParsedDiff, ProgramSummary, View, VersionInfo } from './types'
import { Button, Card, DiffViewer, SyncBadge } from './components'
import { formatDateTime, fullDate } from './format'

interface Props {
  data: CoachData
  program: ProgramSummary
  client: Client | undefined
  navigate: (v: View) => void
  action: (path: string, body?: unknown) => Promise<unknown>
  refresh: () => Promise<void>
}

export function ProgramPage({ program, client, navigate, action, refresh }: Props) {
  const [diff, setDiff] = useState<ParsedDiff | null>(null)
  const [history, setHistory] = useState<VersionInfo[]>([])
  const [versionDiff, setVersionDiff] = useState<{ hash: string; diff: ParsedDiff | null } | null>(null)
  const [message, setMessage] = useState(`Adjust ${program.doc.name}`)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => {
    if (program.hasPendingDiff) {
      fetch(`/__program/${program.id}/diff`)
        .then((r) => r.json() as Promise<{ diff: ParsedDiff | null }>)
        .then((j) => setDiff(j.diff))
        .catch(() => {})
    }
    fetch(`/__program/${program.id}/history`)
      .then((r) => r.json() as Promise<{ versions: VersionInfo[] }>)
      .then((j) => setHistory(j.versions))
      .catch(() => {})
  }, [program.id, program.hasPendingDiff])

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label)
    setError(null)
    setNotice(null)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  function sync() {
    void run('syncing', async () => {
      await action(`/__sync/${program.id}`)
      setNotice('Synced to Google Calendar — your client can add it to their calendar.')
    })
  }

  function resync() {
    void run('resyncing', async () => {
      await action(`/__resync/${program.id}`)
      setNotice('Calendar updated to the current program version.')
    })
  }

  function apply() {
    void run('applying', async () => {
      await action(`/__program/${program.id}/apply`, { message })
      setDiff(null)
      setNotice(`Applied. New version committed.`)
    })
  }

  function discard() {
    void run('discarding', async () => {
      await action(`/__program/${program.id}/discard`)
      setDiff(null)
      setNotice('Changes discarded.')
    })
  }

  function del() {
    void run('deleting', async () => {
      await action(`/__program/${program.id}/delete`)
      navigate({ kind: 'client', id: program.clientId })
    })
  }

  async function loadVersionDiff(hash: string) {
    try {
      const res = await fetch(`/__program/${program.id}/version/${hash}`)
      const json = (await res.json()) as { diff: ParsedDiff | null }
      setVersionDiff({ hash, diff: json.diff })
    } catch {
      setVersionDiff({ hash, diff: null })
    }
  }

  const weeks = useMemo(() => {
    const map = new Map<number, typeof program.doc.sessions>()
    for (const s of program.doc.sessions) {
      if (!map.has(s.week)) map.set(s.week, [])
      map.get(s.week)!.push(s)
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0])
  }, [program.doc.sessions])

  const syncState = program.sync
  const canShare = !!client?.email
  const firstDate = program.doc.sessions[0]?.date
  const lastDate = program.doc.sessions[program.doc.sessions.length - 1]?.date

  return (
    <div className="mx-auto max-w-4xl">
      <button
        onClick={() => navigate({ kind: 'client', id: program.clientId })}
        className="cursor-pointer text-sm text-zinc-400 hover:text-zinc-100"
      >
        &larr; {client?.name ?? 'Client'}
      </button>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{program.doc.name}</h1>
          {program.doc.goal && <p className="mt-1 text-sm text-zinc-400">{program.doc.goal}</p>}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
            <span>
              {firstDate} &rarr; {lastDate}
            </span>
            <span>{program.doc.weeks} weeks</span>
            <span>{program.doc.sessions.length} sessions</span>
            {program.errors.length > 0 && <span className="text-red-400">{program.errors[0]}</span>}
          </div>
          {program.doc.notes && <p className="mt-3 text-sm text-zinc-400">{program.doc.notes}</p>}
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <SyncBadge status={program.syncStatus} />
          {syncState && (
            <>
              <a
                href={syncState.addLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                Add to my Google Calendar &rarr;
              </a>
              <span className="text-xs text-zinc-500">
                shared with {syncState.sharedWithEmail} &middot; {syncState.events.length} events &middot;{' '}
                {syncState.syncedAt.slice(0, 10)}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {program.syncStatus === 'none' && (
          <>
            <Button onClick={sync} disabled={busy !== null || !canShare}>
              {busy === 'syncing' ? 'Syncing…' : 'Sync to Google Calendar'}
            </Button>
            {!canShare && (
              <span className="text-xs text-amber-400">
                No email set for {client?.name ?? 'this client'} — ask your assistant to add it to data/clients.json
              </span>
            )}
          </>
        )}
        {program.syncStatus === 'synced' && (
          <Button variant="outline" onClick={resync} disabled={busy !== null}>
            {busy === 'resyncing' ? 'Resyncing…' : 'Resync'}
          </Button>
        )}
        {program.syncStatus === 'changed' && (
          <>
            <span className="text-xs text-amber-400">
              Program changed since last sync — calendar shows the previous version.
            </span>
            <Button onClick={resync} disabled={busy !== null || !canShare}>
              {busy === 'resyncing' ? 'Resyncing…' : 'Resync to Google Calendar'}
            </Button>
          </>
        )}
        <div className="flex-1" />
        {confirmingDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400">
              Delete "{program.doc.name}"{syncState ? ' and its Google Calendar' : ''}?
            </span>
            <Button size="sm" variant="danger" onClick={del} disabled={busy !== null}>
              {busy === 'deleting' ? 'Deleting…' : 'Confirm'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="danger" onClick={() => setConfirmingDelete(true)}>
            Delete program
          </Button>
        )}
      </div>

      {error && <div className="mt-3 rounded-md bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}
      {notice && <div className="mt-3 rounded-md bg-green-500/10 p-3 text-sm text-green-400">{notice}</div>}

      {program.hasPendingDiff && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-amber-400">
            Proposed changes
            {program.pendingStats ? ` · +${program.pendingStats.added} \u2212${program.pendingStats.removed}` : ''}
          </h2>
          {diff ? (
            <div className="space-y-3">
              <DiffViewer diff={diff} />
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-zinc-500">Commit message</label>
                  <input
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="w-72 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm outline-none focus:border-zinc-500"
                  />
                </div>
                <Button onClick={apply} disabled={busy !== null}>
                  {busy === 'applying' ? 'Applying…' : 'Apply (create version)'}
                </Button>
                <Button variant="outline" onClick={discard} disabled={busy !== null}>
                  {busy === 'discarding' ? 'Discarding…' : 'Discard'}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Loading diff…</p>
          )}
        </section>
      )}

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Versions ({history.length})
        </h2>
        {history.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-zinc-800">
            {history.map((v) => (
              <div key={v.hash} className="border-b border-zinc-800 last:border-0">
                <button
                  onClick={() => loadVersionDiff(v.hash)}
                  className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left transition-colors hover:bg-zinc-900"
                >
                  <span className="text-sm">{v.message}</span>
                  <span className="text-xs text-zinc-500">
                    {v.shortHash} &middot; {formatDateTime(v.date)}
                  </span>
                </button>
                {versionDiff?.hash === v.hash && versionDiff.diff && (
                  <div className="px-3 pb-3">
                    <DiffViewer diff={versionDiff.diff} />
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">No committed versions yet. Apply the proposed changes to create one.</p>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">Schedule</h2>
        {weeks.map(([weekNum, sessions]) => (
          <Card key={weekNum} className="mb-4">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
              <span className="text-sm font-semibold">Week {weekNum}</span>
              <span className="text-xs text-zinc-500">
                {sessions[0].date} &rarr; {sessions[sessions.length - 1].date}
              </span>
            </div>
            <div className="grid gap-px bg-zinc-800 md:grid-cols-3">
              {sessions.map((s) => (
                <SessionBlock key={s.date} session={s} />
              ))}
            </div>
          </Card>
        ))}
      </section>
    </div>
  )
}

function SessionBlock({ session }: { session: ProgramSummary['doc']['sessions'][number] }) {
  return (
    <div className="bg-zinc-900 p-4">
      <div className="text-xs text-zinc-500">{fullDate(session.date)}</div>
      <div className="mt-0.5 text-sm font-semibold">{session.title}</div>
      {session.focus && <div className="mt-0.5 text-xs text-zinc-500">{session.focus}</div>}
      {session.notes && <div className="mt-1 text-xs text-zinc-400">{session.notes}</div>}
      <div className="mt-3">
        {session.exercises.map((ex, i) => (
          <div key={i} className="border-t border-zinc-800 py-1.5 first:border-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm text-zinc-100">{ex.name}</span>
              <span className="shrink-0 text-xs font-medium text-zinc-300">
                {ex.sets}&times;{ex.reps}
                {ex.intensity && <span className="text-zinc-400"> @ {ex.intensity}</span>}
              </span>
            </div>
            {ex.rest && <div className="mt-0.5 text-xs text-zinc-500">rest {ex.rest}</div>}
            {ex.supersetWith && <div className="mt-0.5 text-xs text-zinc-500">superset with {ex.supersetWith}</div>}
            {ex.notes && <div className="mt-0.5 text-xs text-zinc-400">{ex.notes}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
