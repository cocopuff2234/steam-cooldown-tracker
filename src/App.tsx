import { useState } from 'react'
import './App.css'

function App() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
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
