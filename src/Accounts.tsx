import { useEffect, useState } from 'react'
import { supabase } from './supabase'

type SteamAccount = {
  id: number
  steam_id: string | null
  steam_url: string
  name: string | null
  avatar_url: string | null
  cooldown_until: string | null
}

function Accounts() {
  const [accounts, setAccounts] = useState<SteamAccount[]>([])
  const [showForm, setShowForm] = useState(false)
  const [steamUrl, setSteamUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getAccounts()
  }, [])

  async function getAccounts() {
    const { data, error } = await supabase
      .from('steam_accounts')
      .select('*')
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Database error:', error)
      return
    }

    setAccounts(data)
  }

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault()

    setLoading(true)
    setError('')

    // Call our Supabase Edge Function
    const { data: profile, error: functionError } =
      await supabase.functions.invoke('steam-profile', {
        body: {
          url: steamUrl,
        },
      })

    // Edge Function itself failed
    if (functionError) {
      console.error('Function error:', functionError)
      setError('Steam function failed')
      setLoading(false)
      return
    }

    // Steam returned an error
    if (!profile || profile.error) {
      console.error('Steam response:', profile)
      setError(profile?.error ?? 'Could not find Steam profile')
      setLoading(false)
      return
    }

    console.log('Steam profile:', profile)

    // Save Steam profile to Supabase
    const { error: insertError } = await supabase
      .from('steam_accounts')
      .insert({
        steam_id: profile.steamId,
        steam_url: profile.profileUrl,
        name: profile.name,
        avatar_url: profile.avatarUrl,
        cooldown_until: null,
      })

    if (insertError) {
      console.error('Insert error:', insertError)
      setError('Could not add account')
      setLoading(false)
      return
    }

    // Reset form
    setSteamUrl('')
    setShowForm(false)
    setLoading(false)

    // Refresh accounts
    await getAccounts()
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  return (
    <div>
      <header>
        <h1>Steam Accounts</h1>

        <button onClick={handleSignOut}>
          Sign Out
        </button>
      </header>

      {accounts.length === 0 ? (
        <p>No Steam accounts yet.</p>
      ) : (
        accounts.map((account) => (
          <div key={account.id}>
            {account.avatar_url && (
              <img
                src={account.avatar_url}
                alt={account.name ?? 'Steam profile'}
                width="50"
                height="50"
              />
            )}

            <p>{account.name ?? 'Unknown'}</p>
          </div>
        ))
      )}

      {showForm ? (
        <form onSubmit={handleAddAccount}>
          <label htmlFor="steam-url">
            Steam URL
          </label>

          <input
            id="steam-url"
            type="url"
            value={steamUrl}
            onChange={(e) => setSteamUrl(e.target.value)}
            placeholder="https://steamcommunity.com/id/username"
            required
          />

          <button type="submit" disabled={loading}>
            {loading ? 'Adding...' : 'Add Account'}
          </button>

          <button
            type="button"
            onClick={() => {
              setShowForm(false)
              setError('')
            }}
          >
            Cancel
          </button>

          {error && <p>{error}</p>}
        </form>
      ) : (
        <button onClick={() => setShowForm(true)}>
          +
        </button>
      )}
    </div>
  )
}

export default Accounts
