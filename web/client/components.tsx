import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { FetchState } from './api'

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export function Card({
  className,
  flush,
  children,
}: {
  className?: string
  /** No inner padding (for lists that bring their own rows). */
  flush?: boolean
  children: ReactNode
}) {
  return (
    <div className={cn('rounded-xl border border-zinc-800 bg-zinc-900/60', !flush && 'p-4', className)}>{children}</div>
  )
}

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="text-xl font-semibold tracking-tight text-zinc-50">{children}</h1>
}

export function Muted({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-sm text-zinc-400', className)}>{children}</p>
}

export function Spinner() {
  return <p className="py-10 text-center text-sm text-zinc-500">Loading…</p>
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 font-medium underline underline-offset-2">
          Try again
        </button>
      )}
    </div>
  )
}

/** Renders loading / error states, then children with data. */
export function Loaded<T>({
  state,
  children,
}: {
  state: Pick<FetchState<T>, 'data' | 'error' | 'loading' | 'reload'>
  children: (data: T) => ReactNode
}) {
  if (state.error) return <ErrorBox message="Couldn't load this page." onRetry={state.reload} />
  if (state.loading || state.data === null) return <Spinner />
  return <>{children(state.data)}</>
}

export function Page({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-start justify-center px-4 py-10">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between text-sm font-medium text-zinc-300">
        {label}
        {hint && <span className="text-xs font-normal text-zinc-500">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

export function SubmitButton({
  disabled,
  children,
  className,
}: {
  disabled?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className={cn(
        'w-full cursor-pointer rounded-md bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      {children}
    </button>
  )
}
