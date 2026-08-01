import { useCallback, useEffect, useState } from 'react'
import type { CoachData, View } from './types'
import { Dashboard } from './Dashboard'
import { ProgramPage } from './ProgramPage'

export function App() {
  const [data, setData] = useState<CoachData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>({ kind: 'dashboard' })

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/__data')
      if (!res.ok) {
        throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Failed to load data')
      }
      setData((await res.json()) as CoachData)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function action(path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(path, {
      method: 'POST',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Request failed')
    }
    return res.json()
  }

  if (error) {
    return <div className="mx-auto max-w-3xl px-6 py-14 text-red-400">{error}</div>
  }
  if (!data) {
    return <div className="mx-auto max-w-3xl px-6 py-14 text-zinc-400">Loading…</div>
  }

  if (view.kind === 'program') {
    const program = data.programs.find((p) => p.id === view.id)
    if (!program) return <Missing text="Program not found" />
    return <ProgramPage program={program} navigate={setView} action={action} refresh={refresh} />
  }

  return <Dashboard data={data} navigate={setView} />
}

function Missing({ text }: { text: string }) {
  return <div className="mx-auto max-w-3xl px-6 py-14 text-zinc-500">{text}</div>
}
