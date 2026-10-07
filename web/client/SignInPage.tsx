import { useState, type FormEvent } from 'react'
import { authClient } from './auth'
import { navigate } from './router'
import { Card, Field, Muted, Page, PageTitle, SubmitButton } from './components'

const inputClass =
  'w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-base text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-400'

export function SignInPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const result = await authClient.signIn.email({ email: email.trim(), password })
      if (result.error) {
        setError('Email or password is incorrect.')
        setSubmitting(false)
        return
      }
      navigate('/', { replace: true })
    } catch {
      setError('Sign-in failed. Check your connection and try again.')
      setSubmitting(false)
    }
  }

  return (
    <Page>
      <Card>
        <PageTitle>Sign in</PageTitle>
        <Muted className="mt-1">Use the email and password you set when you joined.</Muted>
        <form onSubmit={onSubmit} className="mt-5 space-y-4" noValidate>
          <Field label="Email">
            <input
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </Field>
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          <SubmitButton disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</SubmitButton>
        </form>
      </Card>
    </Page>
  )
}
