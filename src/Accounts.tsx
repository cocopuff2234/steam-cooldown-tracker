import { supabase } from './supabase'

function Accounts() {
  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  return (
    <div>
      <header>
        <h1>Steam Accounts</h1>
        <button onClick={handleSignOut}>Sign Out</button>
      </header>

      <p>No Steam accounts yet.</p>

      <button>+</button>
    </div>
  )
}

export default Accounts
