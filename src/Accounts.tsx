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
  const [hasCooldown, setHasCooldown] = useState(false)
  const [cooldownDays, setCooldownDays] = useState(1)

  const [editingAccount, setEditingAccount] = useState<number | null>(null)
  const [newCooldownDays, setNewCooldownDays] = useState(0)

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

  function calculateCooldownUntil(days: number) {
    const date = new Date()
    date.setDate(date.getDate() + days)
    return date.toISOString()
  }

  function getDaysLeft(cooldownUntil: string | null) {
    if (!cooldownUntil) {
      return 0
    }

    const difference =
      new Date(cooldownUntil).getTime() - Date.now()

    return Math.max(
      0,
      Math.ceil(difference / (1000 * 60 * 60 * 24))
    )
  }

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault()

    setLoading(true)
    setError('')

    const { data: profile, error: functionError } =
      await supabase.functions.invoke('steam-profile', {
        body: {
          url: steamUrl,
        },
      })

    if (functionError) {
      console.error('Function error:', functionError)
      setError('Steam function failed')
      setLoading(false)
      return
    }

    if (!profile || profile.error) {
      console.error('Steam response:', profile)
      setError(profile?.error ?? 'Could not find Steam profile')
      setLoading(false)
      return
    }

    const cooldownUntil = hasCooldown
      ? calculateCooldownUntil(cooldownDays)
      : null

    const { error: insertError } = await supabase
      .from('steam_accounts')
      .insert({
        steam_id: profile.steamId,
        steam_url: profile.profileUrl,
        name: profile.name,
        avatar_url: profile.avatarUrl,
        cooldown_until: cooldownUntil,
      })

    if (insertError) {
      console.error('Insert error:', insertError)
      setError('Could not add account')
      setLoading(false)
      return
    }

    setSteamUrl('')
    setHasCooldown(false)
    setCooldownDays(1)
    setShowForm(false)
    setLoading(false)

    await getAccounts()
  }

  async function handleSetCooldown(id: number) {
    if (newCooldownDays < 0) {
      return
    }

    const cooldownUntil =
      newCooldownDays === 0
        ? null
        : calculateCooldownUntil(newCooldownDays)

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
    setNewCooldownDays(0)

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
        <h1>accounts</h1>

        <button
          className="sign-out"
          onClick={handleSignOut}
        >
          sign out
        </button>
      </header>

      <div className="divider" />

      <div className="account-table">

        {/* Table header */}
        <div className="account-header-row">
          <div className="table-cell pfp-cell"></div>
          <div className="table-cell">name</div>
          <div className="table-cell">cooldown</div>
          <div className="table-cell">days</div>
          <div className="table-cell"></div>
          <div className="table-cell"></div>
        </div>

        {/* Accounts */}
        {accounts.map((account) => {
          const daysLeft = getDaysLeft(account.cooldown_until)
          const onCooldown = daysLeft > 0

          return (
            <div className="account-row" key={account.id}>

              {/* PFP */}
              <div className="table-cell pfp-cell">
                {account.avatar_url && (
                  <img
                    className="pfp"
                    src={account.avatar_url}
                    alt={account.name ?? 'Steam profile'}
                  />
                )}
              </div>

              {/* Name */}
              <div className="table-cell name-cell">
                {account.name ?? 'Unknown'}
              </div>

              {/* Cooldown status */}
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

              {/* Days */}
              <div className="table-cell days-cell">
                {daysLeft}
              </div>

              {/* Edit */}
              <div className="table-cell edit-cell">
                {editingAccount === account.id ? (
                  <div className="edit-controls">

                    <input
                      className="days-input"
                      type="number"
                      min="0"
                      value={newCooldownDays}
                      onChange={(e) =>
                        setNewCooldownDays(Number(e.target.value))
                      }
                    />

                    <button
                      onClick={() =>
                        handleSetCooldown(account.id)
                      }
                    >
                      save
                    </button>

                    <button
                      onClick={() => {
                        setEditingAccount(null)
                        setNewCooldownDays(0)
                      }}
                    >
                      cancel
                    </button>

                  </div>
                ) : (
                  <button
                    className="icon-button"
                    title="Edit cooldown"
                    onClick={() => {
                      setEditingAccount(account.id)
                      setNewCooldownDays(daysLeft)
                    }}
                  >
                    ✎
                  </button>
                )}
              </div>

              {/* Remove */}
              <div className="table-cell remove-cell">
                <button
                  className="remove-button"
                  onClick={() => handleRemove(account.id)}
                >
                  remove
                </button>
              </div>

            </div>
          )
        })}

      </div>

      {/* Add account form */}
      {showForm && (
        <form
          className="add-form"
          onSubmit={handleAddAccount}
        >

          <input
            type="url"
            value={steamUrl}
            onChange={(e) =>
              setSteamUrl(e.target.value)
            }
            placeholder="steam profile url"
            required
          />

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={hasCooldown}
              onChange={(e) =>
                setHasCooldown(e.target.checked)
              }
            />

            cooldown
          </label>

          {hasCooldown && (
            <input
              className="cooldown-input"
              type="number"
              min="1"
              value={cooldownDays}
              onChange={(e) =>
                setCooldownDays(Number(e.target.value))
              }
              placeholder="days"
              required
            />
          )}

          <div className="form-buttons">

            <button
              type="submit"
              disabled={loading}
            >
              {loading ? 'adding...' : 'add'}
            </button>

            <button
              type="button"
              onClick={() => {
                setShowForm(false)
                setError('')
              }}
            >
              cancel
            </button>

          </div>

          {error && (
            <p className="error">
              {error}
            </p>
          )}

        </form>
      )}

      {/* Fixed add button */}
      {!showForm && (
        <button
          className="add-button"
          onClick={() => setShowForm(true)}
          title="Add account"
        >
          +
        </button>
      )}

    </main>
  )
}

export default Accounts
