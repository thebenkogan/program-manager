import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { SyncStatus } from '../shared/types'

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

const buttonVariants = {
  default: 'bg-white text-zinc-900 hover:bg-zinc-200',
  outline: 'border border-zinc-700 text-zinc-200 hover:bg-zinc-800',
  ghost: 'text-zinc-400 hover:text-zinc-100',
  danger: 'bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20',
} as const

export function Button({
  variant = 'default',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof buttonVariants
  size?: 'sm' | 'md'
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm',
        buttonVariants[variant],
        className,
      )}
      {...props}
    />
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-xl border border-zinc-800 bg-zinc-900/60', className)}>{children}</div>
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex cursor-help">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 w-56 -translate-x-1/2 rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs leading-snug text-zinc-100 opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
      >
        {label}
      </span>
    </span>
  )
}

export function CoachCue({ note }: { note: string }) {
  return (
    <Tooltip label={note}>
      <span className="ml-1 inline-flex size-3.5 items-center justify-center rounded-full border border-blue-400/40 text-[9px] font-semibold leading-none text-blue-300/80 transition-colors group-hover:bg-blue-400/10">
        i
      </span>
    </Tooltip>
  )
}

export function SyncBadge({ status }: { status: SyncStatus }) {
  if (status === 'synced') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-400">
        <span className="size-1.5 rounded-full bg-green-400" />
        Synced
      </span>
    )
  }
  if (status === 'changed') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400">
        <span className="size-1.5 rounded-full bg-amber-400" />
        Changed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500">
      <span className="size-1.5 rounded-full bg-zinc-500" />
      Not synced
    </span>
  )
}
