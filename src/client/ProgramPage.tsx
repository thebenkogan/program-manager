import { useEffect, useMemo, useState } from 'react'
import type { ProgramDocument } from '../shared/types'
import type { ProgramSummary, View, VersionInfo } from './types'
import { Button, Card, SyncBadge } from './components'
import { ProgramDiff } from './ProgramDiff'
import { formatDateTime, fullDate } from './format'

interface Props {
  program: ProgramSummary
  navigate: (v: View) => void
  action: (path: string, body?: unknown) => Promise<unknown>
  refresh: () => Promise<void>
}

interface DocPair {
  oldDoc: ProgramDocument | null
  newDoc: ProgramDocument | null
}

export function ProgramPage({ program, navigate, action, refresh }: Props) {
  const [propDiff, setPropDiff] = useState<DocPair | null>(null)
  const [history, setHistory] = useState<VersionInfo[]>([])
  const [versionDiff, setVersionDiff] = useState<DocPair & { hash: string } | null>(null)
  const [message, setMessage] = useState(`Adjust ${program.doc.name}`)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (program.hasPendingDiff) {
      fetch(`/__program/${program.id}/diff`)
        .then((r) => r.json() as Promise<DocPair>)
        .then((j) => setPropDiff(j))
        .catch(() => {})
    } else {
      setPropDiff(null)
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
      setNotice('Synced. Copy the share link below and send it to the client.')
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
      setPropDiff(null)
      setNotice('Applied. New version committed.')
    })
  }

  function discard() {
    void run('discarding', async () => {
      await action(`/__program/${program.id}/discard`)
      setPropDiff(null)
      setNotice('Changes discarded.')
    })
  }

  function del() {
    void run('deleting', async () => {
      await action(`/__program/${program.id}/delete`)
      navigate({ kind: 'dashboard' })
    })
  }

  async function copyShareLink() {
    if (!program.sync) return
    try {
      await navigator.clipboard.writeText(program.sync.addLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable
    }
  }

  async function loadVersionDiff(hash: string) {
    if (versionDiff?.hash === hash) {
      setVersionDiff(null)
      return
    }
    try {
      const res = await fetch(`/__program/${program.id}/version/${hash}`)
      const json = (await res.json()) as DocPair
      setVersionDiff({ hash, oldDoc: json.oldDoc, newDoc: json.newDoc })
    } catch {
      setVersionDiff({ hash, oldDoc: null, newDoc: null })
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
  const firstDate = program.doc.sessions[0]?.date
  const lastDate = program.doc.sessions[program.doc.sessions.length - 1]?.date

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <button onClick={() => navigate({ kind: 'dashboard' })} className="cursor-pointer text-sm text-zinc-400 hover:text-zinc-100">
        &larr; All clients
      </button>

      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold">{program.doc.name}</h1>
          {program.doc.goal && <p className="mt-2 text-sm text-zinc-400">{program.doc.goal}</p>}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
            <span>
              {firstDate} &rarr; {lastDate}
            </span>
            <span>{program.doc.weeks} weeks</span>
            <span>{program.doc.sessions.length} sessions</span>
            {program.errors.length > 0 && <span className="text-red-400">{program.errors[0]}</span>}
          </div>
          {program.doc.notes && <p className="mt-3 text-sm text-zinc-400">{program.doc.notes}</p>}
        </div>

        <div className="flex flex-col items-end gap-2">
          <SyncBadge status={program.syncStatus} />
          {syncState && (
            <>
              <div className="flex items-center gap-2">
                <a
                  href={syncState.addLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-400 hover:text-blue-300"
                >
                  Open share link
                </a>
                <Button size="sm" variant="outline" onClick={copyShareLink}>
                  {copied ? 'Copied!' : 'Copy link'}
                </Button>
              </div>
              <span className="text-xs text-zinc-500">
                {syncState.events.length} events &middot; synced {syncState.syncedAt.slice(0, 10)}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {program.syncStatus === 'none' && (
          <Button onClick={sync} disabled={busy !== null}>
            {busy === 'syncing' ? 'Syncing…' : 'Sync to Google Calendar'}
          </Button>
        )}
        {program.syncStatus === 'changed' && (
          <>
            <span className="text-xs text-amber-400">
              Program changed since last sync — calendar shows the previous version.
            </span>
            <Button onClick={resync} disabled={busy !== null}>
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

      {error && <div className="mt-4 rounded-md bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}
      {notice && <div className="mt-4 rounded-md bg-green-500/10 p-3 text-sm text-green-400">{notice}</div>}

      {program.hasPendingDiff && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-amber-400">
            Proposed changes
            {program.pendingStats ? ` · +${program.pendingStats.added} \u2212${program.pendingStats.removed}` : ''}
          </h2>
          {propDiff?.newDoc ? (
            <div className="space-y-3">
              <ProgramDiff oldDoc={propDiff.oldDoc} newDoc={propDiff.newDoc} />
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

      <section className="mt-8">
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
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">
                      {v.shortHash} &middot; {formatDateTime(v.date)}
                    </span>
                    <svg
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className={`size-4 shrink-0 text-zinc-500 transition-transform ${versionDiff?.hash === v.hash ? 'rotate-180' : ''}`}
                    >
                      <path
                        fillRule="evenodd"
                        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </span>
                </button>
                {versionDiff?.hash === v.hash &&
                  (versionDiff.newDoc ? (
                    <div className="border-t border-zinc-800 px-3 py-3">
                      <ProgramDiff oldDoc={versionDiff.oldDoc} newDoc={versionDiff.newDoc} />
                    </div>
                  ) : (
                    <div className="border-t border-zinc-800 px-3 py-3 text-sm text-zinc-500">
                      Couldn't load a readable diff for this version.
                    </div>
                  ))}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">No committed versions yet. Apply the proposed changes to create one.</p>
        )}
      </section>

      <section className="mt-8">
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
