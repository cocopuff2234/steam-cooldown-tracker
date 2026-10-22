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
  profile_updated_at: string | null
}

type SteamProfile = {
  steamId: string
  name: string
  avatarUrl: string
  profileUrl: string
}

type FilterOption = 'all' | 'active' | 'cooldown'

type SortOption =
  | 'time-asc'
  | 'time-desc'
  | 'name-asc'
  | 'date-asc'

const PROFILE_REFRESH_INTERVAL = 12 * 60 * 60 * 1000
const PROFILE_BATCH_SIZE = 100

function Accounts() {
  const [accounts, setAccounts] = useState<SteamAccount[]>([])
  const [signedInUsername, setSignedInUsername] = useState('')
  const [showForm, setShowForm] = useState(false)

  const [steamUrl, setSteamUrl] = useState('')
  const [hasCooldown, setHasCooldown] = useState(false)
  const [cooldownDays, setCooldownDays] = useState('1')
  const [cooldownHours, setCooldownHours] = useState('0')

  const [editingAccount, setEditingAccount] =
    useState<number | null>(null)

  const [newCooldownDays, setNewCooldownDays] = useState('')
  const [newCooldownHours, setNewCooldownHours] = useState('')

  const [filter, setFilter] =
    useState<FilterOption>('all')

  const [sort, setSort] =
    useState<SortOption>('time-asc')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Used only to force cooldown calculations to rerender.
  const [, setCurrentTime] = useState(Date.now())

  useEffect(() => {
    getAccounts()
    getSignedInUsername()
  }, [])

  // Recalculate days/hours while the page remains open.
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now())
    }, 60 * 1000)

    return () => clearInterval(timer)
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

    const loadedAccounts = (data ?? []) as SteamAccount[]

    // Show cached database data immediately.
    setAccounts(loadedAccounts)

    // Refresh Steam information in the background.
    await refreshStaleProfiles(loadedAccounts)
  }

  function profileNeedsRefresh(updatedAt: string | null) {
    if (!updatedAt) {
      return true
    }

    const updatedTime = new Date(updatedAt).getTime()

    if (Number.isNaN(updatedTime)) {
      return true
    }

    return (
      Date.now() - updatedTime >
      PROFILE_REFRESH_INTERVAL
    )
  }

  async function refreshStaleProfiles(
    loadedAccounts: SteamAccount[]
  ) {
    const staleAccounts = loadedAccounts.filter(
      (account) =>
        account.steam_id &&
        profileNeedsRefresh(account.profile_updated_at)
    )

    if (staleAccounts.length === 0) {
      return
    }

    /*
     * Remove duplicate Steam IDs.
     *
     * This matters if the same Steam account somehow
     * appears more than once.
     */
    const steamIds = [
      ...new Set(
        staleAccounts
          .map((account) => account.steam_id)
          .filter((id): id is string => Boolean(id))
      ),
    ]

    /*
     * The Edge Function accepts at most 100 Steam IDs
     * per request, so split larger lists into batches.
     */
    for (
      let i = 0;
      i < steamIds.length;
      i += PROFILE_BATCH_SIZE
    ) {
      const batch = steamIds.slice(
        i,
        i + PROFILE_BATCH_SIZE
      )

      const { data, error } =
        await supabase.functions.invoke('steam-profile', {
          body: {
            steamIds: batch,
          },
        })

      if (error) {
        console.error(
          'Steam profile refresh failed:',
          error
        )

        continue
      }

      const profiles: SteamProfile[] =
        data?.profiles ?? []

      if (profiles.length === 0) {
        continue
      }

      await updateCachedProfiles(profiles)
    }
  }

  async function updateCachedProfiles(
    profiles: SteamProfile[]
  ) {
    const refreshedAt = new Date().toISOString()

    /*
     * Update each matching row in Supabase.
     *
     * These updates only touch cached Steam profile
     * information. Cooldown data remains unchanged.
     */
    const updates = profiles.map(async (profile) => {
      const { error } = await supabase
        .from('steam_accounts')
        .update({
          name: profile.name,
          avatar_url: profile.avatarUrl,
          steam_url: profile.profileUrl,
          profile_updated_at: refreshedAt,
        })
        .eq('steam_id', profile.steamId)

      if (error) {
        console.error(
          `Failed to update Steam profile ${profile.steamId}:`,
          error
        )

        return
      }

      /*
       * Update local React state too so the user
       * sees the new name/PFP without refreshing.
       */
      setAccounts((currentAccounts) =>
        currentAccounts.map((account) =>
          account.steam_id === profile.steamId
            ? {
                ...account,
                name: profile.name,
                avatar_url: profile.avatarUrl,
                steam_url: profile.profileUrl,
                profile_updated_at: refreshedAt,
              }
            : account
        )
      )
    })

    await Promise.all(updates)
  }

  function calculateCooldownUntil(
    days: number,
    hours: number
  ) {
    const date = new Date()

    date.setTime(
      date.getTime() +
        days * 24 * 60 * 60 * 1000 +
        hours * 60 * 60 * 1000
    )

    return date.toISOString()
  }

  function getTimeLeft(
    cooldownUntil: string | null
  ) {
    if (!cooldownUntil) {
      return {
        days: 0,
        hours: 0,
        milliseconds: 0,
      }
    }

    const difference =
      new Date(cooldownUntil).getTime() -
      Date.now()

    if (difference <= 0) {
      return {
        days: 0,
        hours: 0,
        milliseconds: 0,
      }
    }

    /*
     * Round up to the nearest hour.
     *
     * Example:
     * 2 days + 3h 20m remaining
     * displays as:
     * 2 days | 4 hours
     */
    const totalHours = Math.ceil(
      difference / (1000 * 60 * 60)
    )

    const days = Math.floor(totalHours / 24)
    const hours = totalHours % 24

    return {
      days,
      hours,
      milliseconds: difference,
    }
  }

  function getDateFree(
    cooldownUntil: string | null
  ) {
    if (
      !cooldownUntil ||
      getTimeLeft(cooldownUntil).milliseconds <= 0
    ) {
      return '—'
    }

    return new Date(
      cooldownUntil
    ).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  function getVisibleAccounts() {
    let visibleAccounts = [...accounts]

    if (filter === 'active') {
      visibleAccounts =
        visibleAccounts.filter(
          (account) =>
            getTimeLeft(account.cooldown_until)
              .milliseconds <= 0
        )
    }

    if (filter === 'cooldown') {
      visibleAccounts =
        visibleAccounts.filter(
          (account) =>
            getTimeLeft(account.cooldown_until)
              .milliseconds > 0
        )
    }

    visibleAccounts.sort((a, b) => {
      const aTime =
        getTimeLeft(
          a.cooldown_until
        ).milliseconds

      const bTime =
        getTimeLeft(
          b.cooldown_until
        ).milliseconds

      if (sort === 'time-asc') {
        return aTime - bTime
      }

      if (sort === 'time-desc') {
        return bTime - aTime
      }

      if (sort === 'name-asc') {
        return (a.name ?? '').localeCompare(
          b.name ?? ''
        )
      }

      if (sort === 'date-asc') {
        if (
          !a.cooldown_until &&
          !b.cooldown_until
        ) {
          return 0
        }

        if (!a.cooldown_until) {
          return -1
        }

        if (!b.cooldown_until) {
          return 1
        }

        return (
          new Date(
            a.cooldown_until
          ).getTime() -
          new Date(
            b.cooldown_until
          ).getTime()
        )
      }

      return 0
    })

    return visibleAccounts
  }

  function closeAddForm() {
    setSteamUrl('')
    setHasCooldown(false)
    setCooldownDays('1')
    setCooldownHours('0')
    setShowForm(false)
    setLoading(false)
    setError('')
  }

  async function handleAddAccount(
    e: React.FormEvent
  ) {
    e.preventDefault()

    setLoading(true)
    setError('')

    const {
      data: userData,
      error: userError,
    } = await supabase.auth.getUser()

    if (
      userError ||
      !userData.user
    ) {
      console.error(
        'User error:',
        userError
      )

      setError(
        'could not determine signed in user'
      )

      setLoading(false)
      return
    }

    let cooldownUntil:
      | string
      | null = null

    if (hasCooldown) {
      if (
        cooldownDays.trim() === '' ||
        cooldownHours.trim() === ''
      ) {
        setError(
          'enter cooldown time'
        )

        setLoading(false)
        return
      }

      const days =
        Number(cooldownDays)

      const hours =
        Number(cooldownHours)

      if (
        Number.isNaN(days) ||
        Number.isNaN(hours) ||
        days < 0 ||
        hours < 0 ||
        hours > 23
      ) {
        setError(
          'enter a valid cooldown'
        )

        setLoading(false)
        return
      }

      if (
        days === 0 &&
        hours === 0
      ) {
        setError(
          'cooldown must be greater than 0'
        )

        setLoading(false)
        return
      }

      cooldownUntil =
        calculateCooldownUntil(
          days,
          hours
        )
    }

    const {
      data: profile,
      error: functionError,
    } =
      await supabase.functions.invoke(
        'steam-profile',
        {
          body: {
            url: steamUrl,
          },
        }
      )

    if (functionError) {
      console.error(
        'Function error:',
        functionError
      )

      setError(
        'steam lookup failed'
      )

      setLoading(false)
      return
    }

    if (
      !profile ||
      profile.error
    ) {
      setError(
        profile?.error ??
          'could not find steam profile'
      )

      setLoading(false)
      return
    }

    const now =
      new Date().toISOString()

    const {
      error: insertError,
    } = await supabase
      .from('steam_accounts')
      .insert({
        user_id:
          userData.user.id,

        steam_id:
          profile.steamId,

        steam_url:
          profile.profileUrl,

        name:
          profile.name,

        avatar_url:
          profile.avatarUrl,

        cooldown_until:
          cooldownUntil,

        profile_updated_at:
          now,
      })

    if (insertError) {
      console.error(
        'Insert error:',
        insertError
      )

      setError(
        'could not add account'
      )

      setLoading(false)
      return
    }

    closeAddForm()

    await getAccounts()
  }

  async function handleSetCooldown(
    id: number
  ) {
    if (
      newCooldownDays.trim() === '' ||
      newCooldownHours.trim() === ''
    ) {
      return
    }

    const days =
      Number(newCooldownDays)

    const hours =
      Number(newCooldownHours)

    if (
      Number.isNaN(days) ||
      Number.isNaN(hours) ||
      days < 0 ||
      hours < 0 ||
      hours > 23
    ) {
      return
    }

    const cooldownUntil =
      days === 0 &&
      hours === 0
        ? null
        : calculateCooldownUntil(
            days,
            hours
          )

    const { error } =
      await supabase
        .from('steam_accounts')
        .update({
          cooldown_until:
            cooldownUntil,
        })
        .eq('id', id)

    if (error) {
      console.error(
        'Update error:',
        error
      )

      return
    }

    setEditingAccount(null)
    setNewCooldownDays('')
    setNewCooldownHours('')

    await getAccounts()
  }

  async function handleRemove(
    id: number
  ) {
    const { error } =
      await supabase
        .from('steam_accounts')
        .delete()
        .eq('id', id)

    if (error) {
      console.error(
        'Delete error:',
        error
      )

      return
    }

    await getAccounts()
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  const visibleAccounts =
    getVisibleAccounts()

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

      <div className="table-controls">
        <select
          value={filter}
          onChange={(e) =>
            setFilter(
              e.target.value as FilterOption
            )
          }
        >
          <option value="all">
            all accounts
          </option>

          <option value="active">
            active
          </option>

          <option value="cooldown">
            cooldown
          </option>
        </select>

        <select
          value={sort}
          onChange={(e) =>
            setSort(
              e.target.value as SortOption
            )
          }
        >
          <option value="time-asc">
            time ↑
          </option>

          <option value="time-desc">
            time ↓
          </option>

          <option value="name-asc">
            name a-z
          </option>

          <option value="date-asc">
            date free
          </option>
        </select>
      </div>

      <div className="account-table">
        <div className="account-header-row">
          <div className="table-cell pfp-cell"></div>
          <div className="table-cell">name</div>
          <div className="table-cell">cooldown</div>
          <div className="table-cell">days</div>
          <div className="table-cell">hours</div>
          <div className="table-cell">date free</div>
          <div className="table-cell"></div>
        </div>

        {visibleAccounts.map(
          (account) => {
            const timeLeft =
              getTimeLeft(
                account.cooldown_until
              )

            const onCooldown =
              timeLeft.milliseconds > 0

            return (
              <div
                className="account-row"
                key={account.id}
              >
                <div className="table-cell pfp-cell">
                  {account.avatar_url && (
                    <a
                      href={
                        account.steam_url
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <img
                        className="pfp"
                        src={
                          account.avatar_url
                        }
                        alt={
                          account.name ??
                          'Steam profile'
                        }
                      />
                    </a>
                  )}
                </div>

                <div className="table-cell name-cell">
                  <a
                    className="profile-link"
                    href={
                      account.steam_url
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {account.name ??
                      'Unknown'}
                  </a>
                </div>

                <div className="table-cell status-cell">
                  {onCooldown ? (
                    <>
                      <span className="status-icon cooldown-icon">
                        ✕
                      </span>

                      <span>
                        cooldown
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="status-icon active-icon">
                        ✓
                      </span>

                      <span>
                        active
                      </span>
                    </>
                  )}
                </div>

                <div className="table-cell time-cell">
                  {editingAccount ===
                  account.id ? (
                    <input
                      className="time-input"
                      type="number"
                      min="0"
                      value={
                        newCooldownDays
                      }
                      onChange={(e) =>
                        setNewCooldownDays(
                          e.target.value
                        )
                      }
                    />
                  ) : (
                    <span>
                      {timeLeft.days}
                    </span>
                  )}
                </div>

                <div className="table-cell time-cell">
                  {editingAccount ===
                  account.id ? (
                    <div className="hours-edit">
                      <input
                        className="time-input"
                        type="number"
                        min="0"
                        max="23"
                        value={
                          newCooldownHours
                        }
                        onChange={(e) =>
                          setNewCooldownHours(
                            e.target.value
                          )
                        }
                      />

                      <button
                        className="edit-action-button save-action"
                        title="save"
                        onClick={() =>
                          handleSetCooldown(
                            account.id
                          )
                        }
                      >
                        ✓
                      </button>

                      <button
                        className="edit-action-button cancel-action"
                        title="cancel"
                        onClick={() => {
                          setEditingAccount(
                            null
                          )

                          setNewCooldownDays(
                            ''
                          )

                          setNewCooldownHours(
                            ''
                          )
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="hours-display">
                      <span>
                        {timeLeft.hours}
                      </span>

                      <button
                        className="icon-button"
                        title="edit cooldown"
                        onClick={() => {
                          setEditingAccount(
                            account.id
                          )

                          setNewCooldownDays(
                            String(
                              timeLeft.days
                            )
                          )

                          setNewCooldownHours(
                            String(
                              timeLeft.hours
                            )
                          )
                        }}
                      >
                        ✎
                      </button>
                    </div>
                  )}
                </div>

                <div className="table-cell date-cell">
                  {getDateFree(
                    account.cooldown_until
                  )}
                </div>

                <div className="table-cell remove-cell">
                  <button
                    className="remove-button"
                    title="remove account"
                    onClick={() =>
                      handleRemove(
                        account.id
                      )
                    }
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          }
        )}
      </div>

      {showForm && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (
              e.target ===
              e.currentTarget
            ) {
              closeAddForm()
            }
          }}
        >
          <form
            className="add-modal"
            onSubmit={
              handleAddAccount
            }
          >
            <div className="add-modal-header">
              <h2>
                add steam account
              </h2>

              <button
                type="button"
                className="close-button"
                onClick={
                  closeAddForm
                }
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
                onChange={(e) =>
                  setSteamUrl(
                    e.target.value
                  )
                }
                placeholder="https://steamcommunity.com/id/..."
                required
                autoFocus
              />
            </div>

            <label className="cooldown-toggle">
              <input
                type="checkbox"
                checked={
                  hasCooldown
                }
                onChange={(e) =>
                  setHasCooldown(
                    e.target.checked
                  )
                }
              />

              <span>
                account is on cooldown
              </span>
            </label>

            {hasCooldown && (
              <div className="cooldown-time-fields">
                <div className="form-field">
                  <label htmlFor="cooldown-days">
                    cooldown days
                  </label>

                  <div className="time-field-row">
                    <input
                      id="cooldown-days"
                      type="number"
                      min="0"
                      value={
                        cooldownDays
                      }
                      onChange={(e) =>
                        setCooldownDays(
                          e.target.value
                        )
                      }
                      required
                    />

                    <span>
                      days
                    </span>
                  </div>
                </div>

                <div className="form-field">
                  <label htmlFor="cooldown-hours">
                    cooldown hours
                  </label>

                  <div className="time-field-row">
                    <input
                      id="cooldown-hours"
                      type="number"
                      min="0"
                      max="23"
                      value={
                        cooldownHours
                      }
                      onChange={(e) =>
                        setCooldownHours(
                          e.target.value
                        )
                      }
                      required
                    />

                    <span>
                      hours
                    </span>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <p className="error">
                {error}
              </p>
            )}

            <div className="modal-actions">
              <button
                type="button"
                onClick={
                  closeAddForm
                }
              >
                cancel
              </button>

              <button
                type="submit"
                className="primary-button"
                disabled={loading}
              >
                {loading
                  ? 'adding...'
                  : 'add account'}
              </button>
            </div>
          </form>
        </div>
      )}

      {!showForm && (
        <button
          className="add-button"
          onClick={() =>
            setShowForm(true)
          }
          title="add account"
        >
          +
        </button>
      )}
    </main>
  )
}

export default Accounts
