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
      <form className="login-form" onSubmit={handleSubmit}>
        <input
          type="text"
          id="username"
          value={username}
          placeholder="username"
          onChange={(e) => setUsername(e.target.value)}
          required
        />

        <input
          type="password"
          id="password"
          value={password}
          placeholder="password"
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <button type="submit">login</button>

        {error && <p className="error">{error}</p>}
      </form>
    </main>
  )
}

export default App
