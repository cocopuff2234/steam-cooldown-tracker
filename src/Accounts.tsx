import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { users } from './users'

type SteamAccount = {
  id: number
  user_id: string
  steam_id: string | null
  steam_url: string
  name: string | null
  avatar_url: string | null
  cooldown_until: string | null
}

function Accounts() {
  const [accounts, setAccounts] = useState<SteamAccount[]>([])
  const [signedInUsername, setSignedInUsername] = useState('')
  const [showForm, setShowForm] = useState(false)

  const [steamUrl, setSteamUrl] = useState('')
  const [hasCooldown, setHasCooldown] = useState(false)
  const [cooldownDays, setCooldownDays] = useState(1)

  const [editingAccount, setEditingAccount] = useState<number | null>(null)
  const [newCooldownDays, setNewCooldownDays] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getAccounts()
    getSignedInUsername()
  }, [])

  async function getSignedInUsername() {
    const { data } = await supabase.auth.getUser()

    const email = data.user?.email

    if (!email) {
      return
    }

    const username = Object.keys(users).find(
      (name) => users[name] === email
    )

    if (username) {
      setSignedInUsername(username)
    }
  }

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

  function calculateCooldownUntil(days: number) {
    const date = new Date()
    date.setDate(date.getDate() + days)

    return date.toISOString()
  }

  function getDaysLeft(cooldownUntil: string | null) {
    if (!cooldownUntil) return 0

    const difference =
      new Date(cooldownUntil).getTime() - Date.now()

    return Math.max(
      0,
      Math.ceil(difference / (1000 * 60 * 60 * 24))
    )
  }

  function getDateFree(cooldownUntil: string | null) {
    if (!cooldownUntil || getDaysLeft(cooldownUntil) === 0) {
      return '—'
    }

    return new Date(cooldownUntil).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  function closeAddForm() {
    setSteamUrl('')
    setHasCooldown(false)
    setCooldownDays(1)
    setShowForm(false)
    setLoading(false)
    setError('')
  }

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault()

    setLoading(true)
    setError('')

    /*
     * Get the currently logged-in Supabase user.
     * Their UUID becomes the owner of the Steam account.
     */
    const { data: userData, error: userError } =
      await supabase.auth.getUser()

    if (userError || !userData.user) {
      console.error('User error:', userError)
      setError('could not determine signed in user')
      setLoading(false)
      return
    }

    const { data: profile, error: functionError } =
      await supabase.functions.invoke('steam-profile', {
        body: {
          url: steamUrl,
        },
      })

    if (functionError) {
      console.error('Function error:', functionError)
      setError('steam lookup failed')
      setLoading(false)
      return
    }

    if (!profile || profile.error) {
      setError(profile?.error ?? 'could not find steam profile')
      setLoading(false)
      return
    }

    const cooldownUntil = hasCooldown
      ? calculateCooldownUntil(cooldownDays)
      : null

    const { error: insertError } = await supabase
      .from('steam_accounts')
      .insert({
        user_id: userData.user.id,
        steam_id: profile.steamId,
        steam_url: profile.profileUrl,
        name: profile.name,
        avatar_url: profile.avatarUrl,
        cooldown_until: cooldownUntil,
      })

    if (insertError) {
      console.error('Insert error:', insertError)
      setError('could not add account')
      setLoading(false)
      return
    }

    closeAddForm()
    await getAccounts()
  }

  async function handleSetCooldown(id: number) {
    if (newCooldownDays.trim() === '') {
      return
    }

    const days = Number(newCooldownDays)

    if (Number.isNaN(days) || days < 0) {
      return
    }

    const cooldownUntil =
      days === 0
        ? null
        : calculateCooldownUntil(days)

    const { error } = await supabase
      .from('steam_accounts')
      .update({
        cooldown_until: cooldownUntil,
      })
      .eq('id', id)

    if (error) {
      console.error('Update error:', error)
      return
    }

    setEditingAccount(null)
    setNewCooldownDays('')

    await getAccounts()
  }

  async function handleRemove(id: number) {
    const { error } = await supabase
      .from('steam_accounts')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Delete error:', error)
      return
    }

    await getAccounts()
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <h1>
          {signedInUsername
            ? `${signedInUsername}'s accounts`
            : 'accounts'}
        </h1>

        <button
          className="sign-out"
          onClick={handleSignOut}
        >
          sign out
        </button>
      </header>

      <div className="divider" />

      <div className="account-table">
        <div className="account-header-row">
          <div className="table-cell pfp-cell"></div>
          <div className="table-cell">name</div>
          <div className="table-cell">cooldown</div>
          <div className="table-cell">days</div>
          <div className="table-cell">date free</div>
          <div className="table-cell"></div>
        </div>

        {accounts.map((account) => {
          const daysLeft = getDaysLeft(account.cooldown_until)
          const onCooldown = daysLeft > 0

          return (
            <div className="account-row" key={account.id}>
              <div className="table-cell pfp-cell">
                {account.avatar_url && (
                  <a
                    href={account.steam_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      className="pfp"
                      src={account.avatar_url}
                      alt={account.name ?? 'Steam profile'}
                    />
                  </a>
                )}
              </div>

              <div className="table-cell name-cell">
                <a
                  className="profile-link"
                  href={account.steam_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {account.name ?? 'Unknown'}
                </a>
              </div>

              <div className="table-cell status-cell">
                {onCooldown ? (
                  <>
                    <span className="status-icon cooldown-icon">
                      ✕
                    </span>
                    <span>cooldown</span>
                  </>
                ) : (
                  <>
                    <span className="status-icon active-icon">
                      ✓
                    </span>
                    <span>active</span>
                  </>
                )}
              </div>

              <div className="table-cell days-cell">
                {editingAccount === account.id ? (
                  <div className="edit-controls">
                    <input
                      className="days-input"
                      type="number"
                      min="0"
                      value={newCooldownDays}
                      onChange={(e) =>
                        setNewCooldownDays(e.target.value)
                      }
                    />

                    <button
                      className="edit-action-button save-action"
                      title="save"
                      onClick={() => handleSetCooldown(account.id)}
                    >
                      ✓
                    </button>

                    <button
                      className="edit-action-button cancel-action"
                      title="cancel"
                      onClick={() => {
                        setEditingAccount(null)
                        setNewCooldownDays('')
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div className="days-display">
                    <span>{daysLeft}</span>

                    <button
                      className="icon-button"
                      title="edit cooldown"
                      onClick={() => {
                        setEditingAccount(account.id)
                        setNewCooldownDays(String(daysLeft))
                      }}
                    >
                      ✎
                    </button>
                  </div>
                )}
              </div>

              <div className="table-cell date-cell">
                {getDateFree(account.cooldown_until)}
              </div>

              <div className="table-cell remove-cell">
                <button
                  className="remove-button"
                  title="remove account"
                  onClick={() => handleRemove(account.id)}
                >
                  ✕
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {showForm && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              closeAddForm()
            }
          }}
        >
          <form
            className="add-modal"
            onSubmit={handleAddAccount}
          >
            <div className="add-modal-header">
              <h2>add steam account</h2>

              <button
                type="button"
                className="close-button"
                onClick={closeAddForm}
              >
                ×
              </button>
            </div>

            <div className="form-field">
              <label htmlFor="steam-url">
                steam profile url
              </label>

              <input
                id="steam-url"
                type="url"
                value={steamUrl}
                onChange={(e) => setSteamUrl(e.target.value)}
                placeholder="https://steamcommunity.com/id/..."
                required
                autoFocus
              />
            </div>

            <label className="cooldown-toggle">
              <input
                type="checkbox"
                checked={hasCooldown}
                onChange={(e) => setHasCooldown(e.target.checked)}
              />

              <span>account is on cooldown</span>
            </label>

            {hasCooldown && (
              <div className="form-field cooldown-days-field">
                <label htmlFor="cooldown-days">
                  cooldown days
                </label>

                <div className="days-field-row">
                  <input
                    id="cooldown-days"
                    type="number"
                    min="1"
                    value={cooldownDays}
                    onChange={(e) =>
                      setCooldownDays(Number(e.target.value))
                    }
                    required
                  />

                  <span>days</span>
                </div>
              </div>
            )}

            {error && <p className="error">{error}</p>}

            <div className="modal-actions">
              <button
                type="button"
                onClick={closeAddForm}
              >
                cancel
              </button>

              <button
                type="submit"
                className="primary-button"
                disabled={loading}
              >
                {loading ? 'adding...' : 'add account'}
              </button>
            </div>
          </form>
        </div>
      )}

      {!showForm && (
        <button
          className="add-button"
          onClick={() => setShowForm(true)}
          title="add account"
        >
          +
        </button>
      )}
    </main>
  )
}

export default Accounts
