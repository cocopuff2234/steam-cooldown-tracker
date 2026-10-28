import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { users } from './users'

const invalidLogin = 'Incorrect username or password, or email not confirmed.'

export function getAuthErrorMessage(error: unknown) {
  const details = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {}
  const message = typeof details.message === 'string' ? details.message : ''
  if (details.code === 'over_email_send_rate_limit' || /email.*rate.*limit|rate.*limit.*email/i.test(message)) {
    return 'Email sending limit reached. Please try again later.'
  }
  return message || 'Unable to complete the request. Please try again.'
}

export async function signInWithUsername(username: string, password: string) {
  const normalizedUsername = username.trim().toLowerCase()
  if (!/^[a-z0-9_]{3,24}$/.test(normalizedUsername)) {
    throw new Error(invalidLogin)
  }

  // Keep existing accounts usable while the database-backed flow is deployed.
  if (Object.hasOwn(users, normalizedUsername)) {
    const { error } = await supabase.auth.signInWithPassword({
      email: users[normalizedUsername],
      password,
    })
    if (error) throw new Error(invalidLogin)
    return
  }

  const { data, error } = await supabase.functions.invoke('username-login', {
    body: { username: normalizedUsername, password },
  })
  if (error) {
    const status = error.context?.status
    if (status === 429) throw new Error('Too many login attempts. Please wait a minute and try again.')
    if (status === 503 || status === 404) {
      throw new Error('Username login is currently unavailable. Please try again later.')
    }
    throw new Error(invalidLogin)
  }
  if (typeof data?.access_token !== 'string' || typeof data?.refresh_token !== 'string') {
    throw new Error(invalidLogin)
  }

  const { error: sessionError } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  })
  if (sessionError) throw new Error('Unable to start your session. Please try again.')
}

// Used only for the heading, never for authorizing access or resolving logins.
export function getFallbackUsername(user: Pick<User, 'email' | 'user_metadata'>) {
  const legacyUsername = Object.keys(users).find(
    (username) => users[username].toLowerCase() === user.email?.toLowerCase()
  )
  if (legacyUsername) return legacyUsername

  const metadataUsername = user.user_metadata.username
  if (typeof metadataUsername !== 'string') return ''
  const normalizedUsername = metadataUsername.trim().toLowerCase()
  return /^[a-z0-9_]{3,24}$/.test(normalizedUsername) ? normalizedUsername : ''
}
