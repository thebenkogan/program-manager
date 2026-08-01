import type { CoachData, View } from './types'
import { SyncBadge } from './components'

export function Dashboard({ data, navigate }: { data: CoachData; navigate: (v: View) => void }) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Coach</h1>
        {data.pendingFiles.length > 0 && (
          <span className="text-xs text-amber-400">
            {data.pendingFiles.length} uncommitted data file{data.pendingFiles.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="grid gap-4">
        {data.clients.map((client) => {
          const programs = data.programs
            .filter((p) => p.clientId === client.id)
            .sort((a, b) => b.doc.startDate.localeCompare(a.doc.startDate))
          return (
            <div
              key={client.id}
              onClick={() => navigate({ kind: 'client', id: client.id })}
              className="cursor-pointer rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 transition-colors hover:border-zinc-700"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-semibold">{client.name}</div>
                  <div className="mt-0.5 text-sm text-zinc-400">{client.email ?? 'no email set'}</div>
                </div>
                <div className="text-xs text-zinc-500">
                  {programs.length} program{programs.length === 1 ? '' : 's'}
                </div>
              </div>

              {programs.length > 0 && (
                <div className="mt-4 space-y-2">
                  {programs.map((p) => (
                    <button
                      key={p.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        navigate({ kind: 'program', id: p.id })
                      }}
                      className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-left transition-colors hover:border-zinc-700"
                    >
                      <div>
                        <div className="text-sm font-medium">{p.doc.name}</div>
                        <div className="text-xs text-zinc-500">
                          {p.doc.startDate} &middot; {p.doc.weeks} weeks
                          {p.hasPendingDiff && <span className="text-amber-400"> &middot; proposed changes</span>}
                        </div>
                      </div>
                      <SyncBadge status={p.syncStatus} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {data.clients.length === 0 && (
          <p className="text-zinc-500">No clients yet. Ask your assistant to add them to data/clients.json.</p>
        )}
      </div>
    </div>
  )
}
