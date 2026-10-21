import { useEffect, useState } from 'react'
import { supabase } from './supabase'

type SteamAccount = {
  id: number
  steam_url: string
  name: string | null
  avatar_url: string | null
  cooldown_until: string | null
}

function Accounts() {
  const [accounts, setAccounts] = useState<SteamAccount[]>([])

  useEffect(() => {
    async function getAccounts() {
      const { data, error } = await supabase
        .from('steam_accounts')
        .select('*')

      if (error) {
        console.error(error)
        return
      }

      setAccounts(data)
    }

    getAccounts()
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  return (
    <div>
      <header>
        <h1>Steam Accounts</h1>
        <button onClick={handleSignOut}>Sign Out</button>
      </header>

      {accounts.length === 0 ? (
        <p>No Steam accounts yet.</p>
      ) : (
        accounts.map((account) => (
          <div key={account.id}>
            <p>{account.name ?? account.steam_url}</p>
          </div>
        ))
      )}

      <button>+</button>
    </div>
  )
}

export default Accounts
