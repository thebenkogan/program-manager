import { useState, type FormEvent } from 'react'
import { apiPost, useFetch } from './api'
import { navigate } from './router'
import { passwordError } from './format'
import { Card, ErrorBox, Field, Muted, Page, PageTitle, Spinner, SubmitButton } from './components'

interface InviteInfo {
  valid: boolean
  email?: string
  clientName?: string
  expiresAt?: string
}

const inputClass =
  'w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-base text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-400'

export function InvitePage({ token }: { token: string }) {
  const invite = useFetch<InviteInfo>(`/api/invites/${encodeURIComponent(token)}`, { auth: false })
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const problem = passwordError(password, confirm)
    if (problem) {
      setFormError(problem)
      return
    }
    setFormError(null)
    setSubmitting(true)
    try {
      await apiPost('/api/invites/redeem', { token, password })
      navigate('/', { replace: true })
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
      setSubmitting(false)
    }
  }

  return (
    <Page>
      {invite.loading && <Spinner />}
      {invite.error && <ErrorBox message="Couldn't check this invite. Try again in a moment." onRetry={invite.reload} />}
      {invite.data && !invite.data.valid && (
        <Card>
          <PageTitle>Invite not valid</PageTitle>
          <Muted className="mt-2">
            This link has expired, was already used, or is wrong. Ask your coach for a new one.
          </Muted>
        </Card>
      )}
      {invite.data?.valid && (
        <Card>
          <PageTitle>Welcome, {invite.data.clientName}</PageTitle>
          <Muted className="mt-1">Set a password to create your account.</Muted>
          <p className="mt-4 text-sm text-zinc-300">
            Email: <span className="font-medium text-zinc-100">{invite.data.email}</span>
          </p>
          <form onSubmit={onSubmit} className="mt-5 space-y-4" noValidate>
            <Field label="Password" hint="At least 8 characters">
              <input
                type="password"
                name="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Confirm password">
              <input
                type="password"
                name="confirm"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={inputClass}
              />
            </Field>
            {formError && <p className="text-sm text-red-400">{formError}</p>}
            <SubmitButton disabled={submitting}>{submitting ? 'Creating account…' : 'Create account'}</SubmitButton>
          </form>
        </Card>
      )}
    </Page>
  )
}
