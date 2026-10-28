import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { isIP } from 'node:net'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
}
const maxBodyBytes = 4096
const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}

function json(body: object, status: number) {
  return Response.json(body, { status, headers: corsHeaders })
}

function invalidCredentials() {
  return json({ error: 'Invalid credentials' }, 401)
}

function tryLater(status: 429 | 503) {
  return Response.json({ error: 'Please try again later' }, {
    status,
    headers: { ...corsHeaders, 'Retry-After': '60' },
  })
}

async function readBody(req: Request): Promise<unknown> {
  const length = req.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBodyBytes)) {
    throw new Error('Invalid body length')
  }
  if (!req.body) throw new Error('Missing body')

  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBodyBytes) {
        await reader.cancel()
        throw new Error('Body too large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', Allow: 'POST, OPTIONS' },
    })
  }
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return json({ error: 'Expected JSON body' }, 415)
  }

  let body: unknown
  try {
    body = await readBody(req)
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return invalidCredentials()
  }
  const { username, password } = body as Record<string, unknown>
  if (typeof username !== 'string' || typeof password !== 'string' ||
      username.length > 128 || password.length === 0 || password.length > 1024) {
    return invalidCredentials()
  }
  const normalizedUsername = username.trim().toLowerCase()
  if (!/^[a-z0-9_]{3,24}$/.test(normalizedUsername)) return invalidCredentials()

  try {
    const url = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!url || !serviceKey || !anonKey) return tryLater(503)

    // Never trust arbitrary forwarded headers. A configured gateway must supply
    // one verified address on every request; missing/malformed headers fail closed.
    const trustedIpHeader = Deno.env.get('USERNAME_LOGIN_TRUSTED_IP_HEADER')
    const callerIp = trustedIpHeader ? req.headers.get(trustedIpHeader)?.trim() : undefined
    if (trustedIpHeader && (!callerIp || isIP(callerIp) === 0)) return tryLater(503)

    const admin = createClient(url, serviceKey, clientOptions)
    try {
      const { data: allowed, error: limitError } = await admin.rpc('consume_username_login_attempt', {
        p_username: normalizedUsername,
        p_verified_ip: callerIp ?? null,
      })
      if (limitError || typeof allowed !== 'boolean') return tryLater(503)
      if (!allowed) return tryLater(429)
    } catch {
      return tryLater(503)
    }

    const { data: profile, error: profileError } = await admin
      .from('profiles').select('id').eq('username', normalizedUsername).maybeSingle()
    if (profileError || !profile) return invalidCredentials()

    const { data: userData, error: userError } = await admin.auth.admin.getUserById(profile.id)
    if (userError || !userData.user?.email) return invalidCredentials()

    // Auth accepts sb-forwarded-for only with a server-side service-role API key.
    const anon = createClient(url, anonKey, {
      ...clientOptions,
      global: {
        fetch: (input, init) => {
          const headers = new Headers(init?.headers)
          const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
          if (callerIp && target.origin === new URL(url).origin && target.pathname === '/auth/v1/token') {
            headers.set('apikey', serviceKey)
            headers.set('sb-forwarded-for', callerIp)
          }
          return fetch(input, { ...init, headers })
        },
      },
    })
    const { data, error } = await anon.auth.signInWithPassword({
      email: userData.user.email,
      password,
    })
    if (error || !data.session) return invalidCredentials()

    return json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    }, 200)
  } catch {
    // Never return or log provider errors: they may contain identity information.
    return invalidCredentials()
  }
})
