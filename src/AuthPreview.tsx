import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from './supabase'
import { getAuthErrorMessage } from './auth'

type AuthPreviewProps = {
  page: 'signup' | 'forgot-password' | 'reset-password'
  recoveryReady?: boolean
  recoveryError?: string
  onBack: () => void
}

function AuthField({ kind, label, id }: {
  kind: 'email' | 'username' | 'password'
  label: string
  id: string
}) {
  const [visible, setVisible] = useState(false)
  const isPassword = kind === 'password'

  return (
    <div className={`login-field${isPassword ? ' password-field' : ''}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        {kind === 'email' ? (
          <>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 6 9 7 9-7" />
          </>
        ) : kind === 'username' ? (
          <>
            <circle cx="12" cy="7" r="4" />
            <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
          </>
        ) : (
          <>
            <rect x="4" y="10" width="16" height="11" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            <path d="M12 14v3" />
          </>
        )}
      </svg>
      <input
        id={id}
        name={id}
        type={isPassword ? (visible ? 'text' : 'password') : kind === 'email' ? 'email' : 'text'}
        aria-label={label}
        placeholder={label}
        autoComplete={isPassword ? 'new-password' : kind}
        minLength={isPassword ? 8 : kind === 'username' ? 3 : undefined}
        maxLength={kind === 'username' ? 24 : undefined}
        pattern={kind === 'username' ? '[A-Za-z0-9_]{3,24}' : undefined}
        title={kind === 'username' ? '3–24 letters, numbers, or underscores' : undefined}
        required
      />
      {isPassword && (
        <button
          className="password-toggle"
          type="button"
          aria-label={`${visible ? 'Hide' : 'Show'} ${label}`}
          aria-controls={id}
          onClick={() => setVisible((value) => !value)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
            {visible && <path d="m3 3 18 18" />}
          </svg>
        </button>
      )}
    </div>
  )
}

export default function AuthPreview({ page, recoveryReady = false, recoveryError = '', onBack }: AuthPreviewProps) {
  const [busy, setBusy] = useState(false)
  const requestInFlight = useRef(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [complete, setComplete] = useState(false)
  const isSignup = page === 'signup'
  const isReset = page === 'reset-password'

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (requestInFlight.current || complete) return
    const fields = new FormData(event.currentTarget)
    const email = String(fields.get('auth-email') ?? '').trim()
    const username = String(fields.get('signup-username') ?? '').trim().toLowerCase()
    const password = String(fields.get('signup-password') ?? '')
    const confirmation = String(fields.get('signup-confirm-password') ?? '')
    setError('')
    setMessage('')

    if ((isSignup || isReset) && password !== confirmation) {
      setError('passwords do not match')
      return
    }
    if (isReset && !recoveryReady) {
      setError('Open a valid password-reset link from your email first.')
      return
    }

    requestInFlight.current = true
    setBusy(true)
    try {
      if (isSignup) {
        const { error: signupError, data } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { username },
            emailRedirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).href,
          },
        })
        if (signupError) {
          setError(signupError.message.includes('Database error')
            ? 'Unable to create account. That username may already be taken; try another.'
            : getAuthErrorMessage(signupError))
          return
        }
        setMessage(data.session ? 'Account created.' : 'Check your email to confirm your account, then log in. If you already have an account, log in or reset your password.')
      } else if (isReset) {
        const { error: updateError } = await supabase.auth.updateUser({ password })
        if (updateError) throw updateError
        const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
        if (signOutError) throw signOutError
        setMessage('Password updated. You can now return to login.')
      } else {
        const redirect = new URL(import.meta.env.BASE_URL, window.location.origin)
        redirect.searchParams.set('auth', 'reset-password')
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: redirect.href,
        })
        if (resetError) throw resetError
        setMessage('If an account exists for that email, you will receive a password-reset link.')
      }
      setComplete(true)
    } catch (cause) {
      setError(getAuthErrorMessage(cause))
    } finally {
      requestInFlight.current = false
      setBusy(false)
    }
  }

  return (
    <main className="login-page">
      <button className="sign-up" type="button" onClick={onBack} disabled={busy}>back to login</button>
      <section className="login-panel" aria-labelledby="auth-title">
        <h1 className="title" id="auth-title">{isSignup ? 'sign up' : isReset ? 'reset password' : 'forgot password?'}</h1>
        <form
          className="login-form"
          id="auth-preview-form"
          onSubmit={handleSubmit}
        >
          {!isReset && <AuthField kind="email" label="email" id="auth-email" />}
          {(isSignup || isReset) && (
            <>
              {isSignup && <AuthField kind="username" label="username" id="signup-username" />}
              <AuthField kind="password" label="password" id="signup-password" />
              <AuthField kind="password" label="confirm password" id="signup-confirm-password" />
            </>
          )}
        </form>
        <div className="login-footer">
          {(error || recoveryError) && <p className="error" role="alert">{error || recoveryError}</p>}
          <div className="login-actions">
            <button className="login-button auth-submit" type="submit" form="auth-preview-form" disabled={busy || complete || (isReset && !recoveryReady)}>
              {busy ? 'please wait…' : isSignup ? 'sign up' : isReset ? 'save password' : 'reset password'}
            </button>
            <button className="forgot-password" type="button" onClick={onBack} disabled={busy}>back to login</button>
          </div>
        </div>
        <p className="auth-note" role="status">
          {message || (isSignup
            ? 'Usernames: 3–24 letters, numbers, or underscores. Passwords: at least 8 characters.'
            : isReset
              ? recoveryReady ? 'Choose a new password with at least 8 characters.' : 'This reset link is invalid or expired. Request a new one from the login page.'
              : 'Enter your account email to receive a password-reset link.')}
        </p>
      </section>
    </main>
  )
}
