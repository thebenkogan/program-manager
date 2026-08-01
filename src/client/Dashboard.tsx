import type { CoachData, View } from './types'
import { SyncBadge } from './components'

export function Dashboard({ data, navigate }: { data: CoachData; navigate: (v: View) => void }) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <div className="mb-10">
        <h1 className="text-3xl font-bold">Coach</h1>
        {data.pendingFiles.length > 0 && (
          <p className="mt-3 text-xs text-amber-400">
            {data.pendingFiles.length} uncommitted data file{data.pendingFiles.length > 1 ? 's' : ''}
          </p>
        )}
      </div>

      <div className="grid gap-5">
        {data.clients.map((client) => {
          const program = data.programs.find((p) => p.clientId === client.id)
          if (!program) {
            return (
              <div key={client.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-7">
                <div className="text-xl font-semibold">{client.name}</div>
                <p className="mt-2 text-sm text-zinc-500">No program yet — ask your assistant to create one.</p>
              </div>
            )
          }
          return (
            <button
              key={client.id}
              onClick={() => navigate({ kind: 'program', id: program.id })}
              className="w-full cursor-pointer rounded-xl border border-zinc-800 bg-zinc-900/60 p-7 text-left transition-colors hover:border-zinc-600"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xl font-semibold">{client.name}</div>
                  <div className="mt-2 text-base font-medium text-zinc-200">{program.doc.name}</div>
                  <div className="mt-1 text-sm text-zinc-500">
                    {program.doc.startDate} &middot; {program.doc.weeks} weeks &middot; {program.doc.sessions.length}{' '}
                    sessions
                    {program.hasPendingDiff && <span className="text-amber-400"> &middot; proposed changes</span>}
                  </div>
                </div>
                <SyncBadge status={program.syncStatus} />
              </div>
            </button>
          )
        })}

        {data.clients.length === 0 && (
          <p className="text-zinc-500">No clients yet. Ask your assistant to add them to data/clients.json.</p>
        )}
      </div>
    </div>
  )
}
