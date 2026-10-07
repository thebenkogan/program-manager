import { useEffect, useState, useCallback } from 'react'
import type { MeResponse, NextWorkoutResponse, ProgramResponse, ProgressResponse } from '../shared/api'
import { navigate } from './router'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown }
    if (typeof body.error === 'string') return body.error
  } catch {
    // not JSON
  }
  return `Request failed (${res.status})`
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
  if (!res.ok) throw new ApiError(res.status, await readError(res))
  return (await res.json()) as T
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status, await readError(res))
  return (await res.json().catch(() => ({}))) as T
}

export interface FetchState<T> {
  data: T | null
  error: ApiError | null
  loading: boolean
  reload: () => void
}

interface FetchOptions {
  /** Public endpoints (invites) pass false so a 401 does not redirect to sign-in. */
  auth?: boolean
}

/** Loads a GET endpoint. A 401 on a protected endpoint sends the user to /signin. */
export function useFetch<T>(path: string, opts: FetchOptions = {}): FetchState<T> {
  const auth = opts.auth ?? true
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    apiGet<T>(path)
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        const err = e instanceof ApiError ? e : new ApiError(0, 'Network error. Check your connection.')
        if (err.status === 401 && auth) {
          navigate('/signin', { replace: true })
          return
        }
        setError(err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [path, auth, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload }
}

export const endpoints = {
  me: '/api/me',
  next: '/api/me/next',
  program: '/api/me/program',
  progress: '/api/me/progress',
}

export type { MeResponse, NextWorkoutResponse, ProgramResponse, ProgressResponse }
