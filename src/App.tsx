import { useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { authInitialization, getRecoveryUserId, recoveryRequested, supabase } from './supabase'

import { signInWithUsername } from './auth'
import Accounts from './Accounts'
import AuthPreview from './AuthPreview'
import './App.css'

function App() {
  const [page, setPage] = useState<'login' | 'signup' | 'forgot-password' | 'reset-password'>(() =>
    recoveryRequested ? 'reset-password' : 'login'
  )
  const [busy, setBusy] = useState(false)
  const requestInFlight = useRef(false)
  const [recoveryUserId, setRecoveryUserId] = useState(getRecoveryUserId)
  const [initializing, setInitializing] = useState(true)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    let active = true
    authInitialization.then(async ({ error: initializationError }) => {
      const { data, error } = await supabase.auth.getSession()
      if (!active) return
      setSession(data.session)
      setRecoveryUserId(initializationError ? null : getRecoveryUserId())
      const sessionError = initializationError || error
      if (sessionError) setError(sessionError.message)
      setInitializing(false)
    }).catch(() => {
      if (!active) return
      setError('Unable to restore your session. Please log in again.')
      setInitializing(false)
    })

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryUserId(session?.user.id ?? null)
        setPage('reset-password')
      }
      if (event === 'SIGNED_IN') {
        setRecoveryUserId((current) => current === session?.user.id ? current : null)
      }
      if (event === 'SIGNED_OUT') {
        setRecoveryUserId(null)
        setPage((current) => current === 'reset-password' ? current : 'login')
        setPassword('')
        setShowPassword(false)
      }
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (requestInFlight.current) return
    requestInFlight.current = true
    setError('')
    setBusy(true)
    try {
      await signInWithUsername(username, password)
      setPassword('')
      setShowPassword(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to log in. Please try again.')
    } finally {
      requestInFlight.current = false
      setBusy(false)
    }
  }

  function returnToLogin() {
    const url = new URL(window.location.href)
    url.searchParams.delete('auth')
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
    setError('')
    setPage('login')
  }

  if (initializing) {
    return <main className="login-page"><p role="status">loading…</p></main>
  }

  if (page === 'reset-password') {
    return <AuthPreview key={page} page={page} recoveryReady={Boolean(session && session.user.id === recoveryUserId)} recoveryError={error} onBack={returnToLogin} />
  }

  if (session) {
    return <Accounts />
  }

  if (page !== 'login') {
    return <AuthPreview key={page} page={page} onBack={returnToLogin} />
  }

  return (
    <main className="login-page">
      <button className="sign-up" type="button" disabled={busy} onClick={() => setPage('signup')}>sign up</button>
      <section className="login-panel" aria-labelledby="login-title">
        <h1 className="title" id="login-title">Steam Cooldown Tracker</h1>
        <form className="login-form" id="login-form" onSubmit={handleSubmit}>
          <label className="login-field">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <circle cx="12" cy="7" r="4" />
              <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
            </svg>
            <input
              type="text"
              id="username"
              aria-label="Username"
              value={username}
              placeholder="username"
              autoComplete="username"
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </label>

          <div className="login-field password-field">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <rect x="4" y="10" width="16" height="11" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              <path d="M12 14v3" />
            </svg>
            <input
              type={showPassword ? 'text' : 'password'}
              id="password"
              aria-label="Password"
              value={password}
              placeholder="password"
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              className="password-toggle"
              type="button"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-controls="password"
              onClick={() => setShowPassword((visible) => !visible)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                <circle cx="12" cy="12" r="3" />
                {showPassword && <path d="m3 3 18 18" />}
              </svg>
            </button>
          </div>

        </form>
        <div className="login-footer">
          {error && <p className="error" role="alert">{error}</p>}
          <div className="login-actions">
            <button className="login-button" type="submit" form="login-form" disabled={busy}>{busy ? 'logging in…' : 'login'}</button>
            <button className="forgot-password" type="button" disabled={busy} onClick={() => setPage('forgot-password')}>forgot password?</button>
          </div>
        </div>
      </section>
    </main>
  )
}

export default App
