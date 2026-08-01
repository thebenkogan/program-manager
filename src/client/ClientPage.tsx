import type { Client, CoachData, View } from './types'
import { SyncBadge } from './components'
import { lastSessionDate } from './format'

export function ClientPage({
  data,
  client,
  navigate,
}: {
  data: CoachData
  client: Client
  navigate: (v: View) => void
}) {
  const programs = data.programs
    .filter((p) => p.clientId === client.id)
    .sort((a, b) => b.doc.startDate.localeCompare(a.doc.startDate))

  return (
    <div className="mx-auto max-w-3xl">
      <button onClick={() => navigate({ kind: 'dashboard' })} className="cursor-pointer text-sm text-zinc-400 hover:text-zinc-100">
        &larr; All clients
      </button>

      <div className="mb-6 mt-4">
        <h1 className="text-2xl font-bold">{client.name}</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {client.email ?? 'no email set — ask your assistant to set it for calendar sharing'}
        </p>
        {client.notes && <p className="mt-1 text-sm text-zinc-400">{client.notes}</p>}
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
        Programs ({programs.length})
      </h2>
      <div className="space-y-2">
        {programs.map((p) => {
          const last = lastSessionDate(p.doc.sessions)
          return (
            <button
              key={p.id}
              onClick={() => navigate({ kind: 'program', id: p.id })}
              className="w-full cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-left transition-colors hover:border-zinc-700"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{p.doc.name}</div>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    {p.doc.startDate} &rarr; {last ?? '—'} &middot; {p.doc.weeks} weeks &middot;{' '}
                    {p.doc.sessions.length} sessions
                  </div>
                </div>
                <SyncBadge status={p.syncStatus} />
              </div>
              {p.hasPendingDiff && (
                <div className="mt-1 text-xs text-amber-400">Proposed changes pending — review on program page</div>
              )}
            </button>
          )
        })}
        {programs.length === 0 && <p className="text-zinc-500">No programs yet. Ask your assistant to create one.</p>}
      </div>
    </div>
  )
}
