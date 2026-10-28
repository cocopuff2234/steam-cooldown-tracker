import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// Capture recovery intent before the client consumes the callback URL.
export const recoveryRequested = new URL(window.location.href).searchParams.get('auth') === 'reset-password'
  || new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery'

export const supabase = createClient(supabaseUrl, supabaseKey)

let recoveryUserId: string | null = null
export function getRecoveryUserId() {
  return recoveryUserId
}

// Subscribe before React mounts so a fast callback cannot lose PASSWORD_RECOVERY.
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') recoveryUserId = session?.user.id ?? null
  if (event === 'SIGNED_OUT' || (event === 'SIGNED_IN' && session?.user.id !== recoveryUserId)) {
    recoveryUserId = null
  }
})

export const authInitialization = supabase.auth.initialize()
