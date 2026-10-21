import { useState } from 'react'
import { supabase } from './supabase'
import { users } from './users'
import './App.css'

function App() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const email = users[username.toLowerCase()]

    if (!email) {
      setError("wrong user or pw")
      return
    }

    const { error } = await supabase.auth.signInWithPassword({
      email, password,
    })

    if (error) {
      setError('wrong user or pw')
      return
    }

    console.log('success')
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
    </form>
  )
}

export default App
