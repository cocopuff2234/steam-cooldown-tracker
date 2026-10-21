import './App.css'

function App() {
  return (
    <>
      <label htmlFor="username">user</label>
      <input
        type="text"
        id="username"
        name="username"
        placeholder="user"
        required
      />

      <label htmlFor="password">password</label>
      <input
        type="password"
        id="password"
        name="password"
        placeholder="password"
        required
      />

      <button type="submit">submit</button>
    </>
  )
}

export default App
