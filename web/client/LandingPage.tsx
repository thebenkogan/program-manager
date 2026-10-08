import { Link } from './router'
import { cn } from './components'

const PHONE_DISPLAY = '267-799-6588'
const PHONE_TEL = '+12677996588'
const EMAIL = 'benkogan9@gmail.com'
const INSTAGRAM_URL = 'https://instagram.com/coachbenkogan'

/** Public home page for signed-out visitors. */
export function LandingPage() {
  return (
    <div className="min-h-dvh">
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Personal trainer</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-50">Ben Kogan</h1>
        <p className="mt-5 text-base leading-relaxed text-zinc-300">
          I write and run strength programs for clients, one-on-one. Each program is built around your goals, your
          schedule, and what you can recover from.
        </p>
        <p className="mt-4 text-base leading-relaxed text-zinc-300">
          Interested in coaching? Reach out and tell me what you're working toward.
        </p>

        <ul className="mt-8 space-y-3">
          <ContactRow label="Call or text" value={PHONE_DISPLAY} href={`tel:${PHONE_TEL}`} />
          <ContactRow label="Email" value={EMAIL} href={`mailto:${EMAIL}`} />
          <ContactRow label="Instagram" value="@coachbenkogan" href={INSTAGRAM_URL} external />
        </ul>

        <div className="mt-12 border-t border-zinc-800 pt-6 text-sm text-zinc-500">
          Already a client?{' '}
          <Link to="/signin" className="font-medium text-zinc-300 underline underline-offset-2 hover:text-zinc-100">
            Sign in
          </Link>
        </div>
      </main>
    </div>
  )
}

function ContactRow({
  label,
  value,
  href,
  external,
}: {
  label: string
  value: string
  href: string
  external?: boolean
}) {
  return (
    <li>
      <a
        href={href}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        className={cn(
          'flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3',
          'transition-colors hover:border-zinc-600 hover:bg-zinc-900',
        )}
      >
        <span className="text-sm text-zinc-400">{label}</span>
        <span className="text-sm font-medium text-zinc-100">{value}</span>
      </a>
    </li>
  )
}
