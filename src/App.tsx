import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { users } from './users'
import Accounts from './Accounts'
import './App.css'

function App() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => {
      data.subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const email = users[username.toLowerCase()]

    if (!email) {
      setError('wrong user or pw')
      return
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError('wrong user or pw')
    }
  }

  if (session) {
    return <Accounts />
  }

  return (
    <main className="login-page">
      <button className="sign-up">sign up</button>
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
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </label>

          <label className="login-field">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <rect x="4" y="10" width="16" height="11" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              <path d="M12 14v3" />
            </svg>
            <input
              type="password"
              id="password"
              aria-label="Password"
              value={password}
              placeholder="password"
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {error && <p className="error">{error}</p>}
        </form>
        <div className="login-actions">
          <button className="login-button" type="submit" form="login-form">login</button>
          <span className="forgot-password">forgot password?</span>
        </div>
      </section>
    </main>
  )
}

export default App
