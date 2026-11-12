import { useState, type ReactNode } from 'react'
import { authClient } from './auth'
import { setSessionHint } from './session-hint'
import { Link, navigate, usePathname } from './router'
import { cn } from './components'
import { useFetch, endpoints, type MeResponse } from './api'
import { useStaleApp } from './use-app-version'

const tabs = [
  { to: '/', label: 'Next' },
  { to: '/program', label: 'Program' },
  { to: '/progress', label: 'Progress' },
  { to: '/videos', label: 'Videos' },
]

/** Layout for signed-in pages: header, content, bottom tab bar. */
export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname()
  const me = useFetch<MeResponse>(endpoints.me)
  const stale = useStaleApp()
  const [signingOut, setSigningOut] = useState(false)

  async function signOut() {
    setSigningOut(true)
    try {
      await authClient.signOut()
    } finally {
      setSessionHint(false)
      setSigningOut(false)
      navigate('/signin', { replace: true })
    }
  }

  return (
    <div className="min-h-dvh pb-24">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center justify-between px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-zinc-500">Coach</p>
            <p className="truncate text-sm font-medium text-zinc-200">{me.data?.clientName ?? ' '}</p>
          </div>
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="cursor-pointer rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-4 px-4 pt-5">
        {stale && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <span>Update ready</span>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="shrink-0 cursor-pointer rounded border border-amber-500/50 px-2 py-1 font-semibold text-amber-100 hover:bg-amber-500/20"
            >
              Reload
            </button>
          </div>
        )}
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <ul className="mx-auto grid max-w-md grid-cols-4">
          {tabs.map((t) => {
            const active = path === t.to
            return (
              <li key={t.to}>
                <Link
                  to={t.to}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-14 items-center justify-center text-sm font-medium transition-colors',
                    active ? 'text-zinc-50' : 'text-zinc-500 hover:text-zinc-300',
                  )}
                >
                  {t.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}
