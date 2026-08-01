import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { ParsedDiff, SyncStatus } from '../shared/types'

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

export function DiffViewer({ diff }: { diff: ParsedDiff }) {
  return (
    <div className="overflow-hidden rounded-md border border-zinc-800 text-xs font-mono">
      <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 px-3 py-1.5">
        <span className="font-medium text-green-400">+{diff.stats.added}</span>
        <span className="font-medium text-red-400">&minus;{diff.stats.removed}</span>
      </div>
      <div className="max-h-96 overflow-auto bg-zinc-950">
        {diff.lines.map((l, i) => (
          <div
            key={i}
            className={cn(
              'flex px-3',
              l.type === 'add' ? 'bg-green-500/10 text-green-300' : l.type === 'del' ? 'bg-red-500/10 text-red-300' : 'text-zinc-400',
            )}
          >
            <span className="w-8 shrink-0 select-none text-right text-zinc-600">{l.oldLine ?? ''}</span>
            <span className="w-8 shrink-0 select-none text-right text-zinc-600">{l.newLine ?? ''}</span>
            <span className="w-5 shrink-0 select-none">{l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}</span>
            <span className="whitespace-pre-wrap break-all">{l.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
