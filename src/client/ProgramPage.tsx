import { useEffect, useState } from 'react'
import type { ProgramDocument } from '../shared/types'
import type { ProgramSummary, View, VersionInfo } from './types'
import { Button, SyncBadge } from './components'
import { ProgramDiff, Schedule } from './ProgramDiff'
import { formatDateTime } from './format'

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
  const [history, setHistory] = useState<VersionInfo[]>([])
  const [versionDiff, setVersionDiff] = useState<DocPair & { hash: string } | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [message, setMessage] = useState(`Adjust ${program.doc.name}`)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program.id])

  async function loadHistory() {
    try {
      const res = await fetch(`/__program/${program.id}/history`)
      const json = (await res.json()) as { versions: VersionInfo[] }
      setHistory(json.versions)
    } catch {
      // ignore
    }
  }

  async function run(label: string, fn: () => Promise<unknown>, refreshVersions = false) {
    setBusy(label)
    setError(null)
    setNotice(null)
    try {
      await fn()
      await refresh()
      if (refreshVersions) await loadHistory()
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
      setShowDiff(false)
      setNotice('Applied. New version committed.')
    }, true)
  }

  function discard() {
    void run('discarding', async () => {
      await action(`/__program/${program.id}/discard`)
      setShowDiff(false)
      setNotice('Changes discarded.')
    }, true)
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

  const displayed = program.hasPendingDiff && program.committedDoc ? program.committedDoc : program.doc
  const syncState = program.sync
  const firstDate = displayed.sessions[0]?.date
  const lastDate = displayed.sessions[displayed.sessions.length - 1]?.date

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <button onClick={() => navigate({ kind: 'dashboard' })} className="cursor-pointer text-sm text-zinc-400 hover:text-zinc-100">
        &larr; All clients
      </button>

      <div className="mt-6 flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold">{displayed.name}</h1>
          {displayed.goal && <p className="mt-2 text-sm text-zinc-400">{displayed.goal}</p>}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
            <span>
              {firstDate} &rarr; {lastDate}
            </span>
            <span>{displayed.weeks} weeks</span>
            <span>{displayed.sessions.length} sessions</span>
            {program.errors.length > 0 && <span className="text-red-400">{program.errors[0]}</span>}
          </div>
          {displayed.notes && <p className="mt-3 text-sm text-zinc-400">{displayed.notes}</p>}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
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
        {program.hasPendingDiff && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Button variant={showDiff ? 'default' : 'outline'} onClick={() => setShowDiff((v) => !v)}>
              {showDiff ? 'Hide diff' : 'View proposed diff'}
            </Button>
            {program.pendingStats && (
              <span className="text-xs text-zinc-500">
                +{program.pendingStats.added} &minus;{program.pendingStats.removed}
              </span>
            )}
            <div className="flex-1" />
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Commit message"
              className="w-64 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm outline-none focus:border-zinc-500"
            />
            <Button onClick={apply} disabled={busy !== null}>
              {busy === 'applying' ? 'Applying…' : 'Apply'}
            </Button>
            <Button variant="outline" onClick={discard} disabled={busy !== null}>
              {busy === 'discarding' ? 'Discarding…' : 'Discard'}
            </Button>
          </div>
        )}
        <Schedule
          doc={showDiff && program.hasPendingDiff ? program.doc : displayed}
          oldDoc={program.hasPendingDiff ? program.committedDoc : null}
          showDiff={showDiff && program.hasPendingDiff}
        />
      </section>
    </div>
  )
}
