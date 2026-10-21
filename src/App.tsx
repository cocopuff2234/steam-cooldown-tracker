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
      return
    }
  }

  if (session) {
    return <Accounts />
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="username">user</label>
      <input
        type="text"
        id="username"
        value={username}
        placeholder="user"
        onChange={(e) => setUsername(e.target.value)}
        required
      />

      <label htmlFor="password">password</label>
      <input
        type="password"
        id="password"
        value={password}
        placeholder="password"
        onChange={(e) => setPassword(e.target.value)}
        required
      />

      <button type="submit">submit</button>

      {error && <p>{error}</p>}
    </form>
  )
}

export default App
