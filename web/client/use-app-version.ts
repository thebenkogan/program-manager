import { useEffect, useState } from 'react'
import { bundleName, isStale } from '../shared/app-version'

/**
 * The bundle this tab booted with. Read once at import: the script tag is the
 * page's own build, captured before any in-app navigation can confuse it.
 */
const booted = bundleName(document.querySelector('script[type="module"]')?.getAttribute('src'))

/**
 * True when the server is serving a different build than the one running here.
 * A tab that stays open never re-reads index.html, so without this a deploy is
 * invisible for as long as the tab lives. Checked on load, and again whenever
 * the tab comes back to the foreground.
 */
export function useStaleApp(): boolean {
  const [stale, setStale] = useState(false)

  useEffect(() => {
    if (!booted) return
    let cancelled = false
    const check = async () => {
      try {
        const res = await fetch('/api/version', {
          headers: { accept: 'application/json' },
          credentials: 'same-origin',
        })
        if (!res.ok) return
        const body = (await res.json()) as { version?: string | null }
        if (!cancelled) setStale(isStale(booted, body.version ?? null))
      } catch {
        // Offline or blocked: keep the last answer rather than nagging.
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    void check()
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [])

  return stale
}
