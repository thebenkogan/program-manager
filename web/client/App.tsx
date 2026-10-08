import { lazy, Suspense, type ReactNode } from 'react'
import { Shell } from './Shell'
import { InvitePage } from './InvitePage'
import { SignInPage } from './SignInPage'
import { NextPage } from './NextPage'
import { LandingPage } from './LandingPage'
import { useFetch, endpoints, type MeResponse } from './api'
import { ProgramPage } from './ProgramPage'
import { Link, matchPath, usePathname } from './router'
import { Card, PageTitle, Muted, Page } from './components'

// Recharts is large; load the progress page on demand.
const ProgressPage = lazy(() => import('./ProgressPage').then((m) => ({ default: m.ProgressPage })))

type Route =
  | { kind: 'invite'; token: string }
  | { kind: 'signin' }
  | { kind: 'next' }
  | { kind: 'program' }
  | { kind: 'progress' }
  | { kind: 'notFound' }

function resolve(pathname: string): Route {
  const invite = matchPath('/invite/:token', pathname)
  if (invite) return { kind: 'invite', token: invite.token }
  if (matchPath('/signin', pathname)) return { kind: 'signin' }
  if (matchPath('/', pathname)) return { kind: 'next' }
  if (matchPath('/program', pathname)) return { kind: 'program' }
  if (matchPath('/progress', pathname)) return { kind: 'progress' }
  return { kind: 'notFound' }
}

/** Home: the next workout when signed in, the public landing page when not. */
function HomeRoute() {
  const me = useFetch<MeResponse>(endpoints.me, { auth: false })
  if (me.loading) return <p className="py-10 text-center text-sm text-zinc-500">Loading…</p>
  if (me.data) {
    return (
      <Protected>
        <NextPage />
      </Protected>
    )
  }
  return <LandingPage />
}

function Protected({ children }: { children: ReactNode }) {
  return <Shell>{children}</Shell>
}

export function App() {
  const route = resolve(usePathname())
  switch (route.kind) {
    case 'invite':
      return <InvitePage token={route.token} />
    case 'signin':
      return <SignInPage />
    case 'next':
      return <HomeRoute />
    case 'program':
      return (
        <Protected>
          <ProgramPage />
        </Protected>
      )
    case 'progress':
      return (
        <Protected>
          <Suspense fallback={<p className="py-10 text-center text-sm text-zinc-500">Loading…</p>}>
            <ProgressPage />
          </Suspense>
        </Protected>
      )
    case 'notFound':
      return (
        <Page>
          <Card>
            <PageTitle>Page not found</PageTitle>
            <Muted className="mt-2">
              <Link to="/" className="underline underline-offset-2">
                Back to your workout
              </Link>
            </Muted>
          </Card>
        </Page>
      )
  }
}
