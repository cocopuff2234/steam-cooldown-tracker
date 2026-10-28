import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { isIP } from 'node:net'
import ts from 'typescript'

const source = await readFile(new URL('../functions/username-login/index.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source.replace(/^import .*\n/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText

function setup(overrides = {}) {
  let handler
  const calls = []
  const env = {
    SUPABASE_URL: 'https://test.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'server-secret',
    SUPABASE_ANON_KEY: 'anon-key',
    ...overrides.env,
  }
  const createClient = (url, key, options) => {
    calls.push(['client', key, options.auth])
    if (key === 'server-secret') return {
      rpc: async (name, args) => {
        calls.push(['limit', name, args])
        if (overrides.limitThrows) throw new Error('private limiter failure')
        return {
          data: Object.hasOwn(overrides, 'allowed') ? overrides.allowed : true,
          error: overrides.limitError ?? null,
        }
      },
      from: (table) => {
        assert.equal(table, 'profiles')
        return { select: (columns) => {
          assert.equal(columns, 'id')
          return { eq: (column, value) => {
            calls.push(['lookup', column, value])
            return { maybeSingle: async () => ({
              data: overrides.missing ? null : { id: 'user-id' },
              error: overrides.lookupError ?? null,
            }) }
          } }
        } }
      },
      auth: { admin: { getUserById: async (id) => {
        calls.push(['admin', id])
        return { data: { user: { email: 'private@example.test' } }, error: overrides.adminError ?? null }
      } } },
    }
    assert.equal(key, 'anon-key')
    return { auth: { signInWithPassword: async (credentials) => {
      calls.push(['password', credentials])
      // Exercise the actual custom fetch hook without making a network request.
      await options.global.fetch('https://test.invalid/auth/v1/token?grant_type=password', {
        headers: { apikey: key, Authorization: 'Bearer anon-key' },
      })
      return {
        data: { session: overrides.noSession ? null : {
          access_token: 'access', refresh_token: 'refresh', user: { email: credentials.email },
        } },
        error: overrides.authError ?? null,
      }
    } } }
  }
  vm.runInNewContext(compiled, {
    createClient, isIP, Response, Request, Headers, URL, TextDecoder, Uint8Array,
    Deno: { env: { get: (name) => env[name] }, serve: (callback) => { handler = callback } },
    fetch: async (input, init) => { calls.push(['fetch', input, init.headers]); return new Response('{}') },
  })
  return { calls, handler }
}

function post(body, headers = {}) {
  return new Request('https://test.invalid/functions/v1/username-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}
const credentials = { username: ' MyRkA ', password: ' untouched password ' }

test('success normalizes username, preserves password, separates clients, returns only tokens', async () => {
  const { calls, handler } = setup()
  const response = await handler(post(credentials, { 'sb-forwarded-for': 'attacker-ip' }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { access_token: 'access', refresh_token: 'refresh' })
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
  assert.equal(calls[1][0], 'limit')
  assert.equal(calls[1][1], 'consume_username_login_attempt')
  assert.equal(calls[1][2].p_username, 'myrka')
  assert.equal(calls[1][2].p_verified_ip, null)
  assert.deepEqual(Object.keys(calls[1][2]).sort(), ['p_username', 'p_verified_ip'])
  assert.deepEqual(calls.find(([type]) => type === 'lookup'), ['lookup', 'username', 'myrka'])
  const passwordCall = calls.find(([type]) => type === 'password')[1]
  assert.equal(passwordCall.email, 'private@example.test')
  assert.equal(passwordCall.password, credentials.password)
  assert.deepEqual(calls.filter(([type]) => type === 'client').map((call) => call[1]), ['server-secret', 'anon-key'])
  for (const call of calls.filter(([type]) => type === 'client')) {
    assert.equal(call[2].persistSession, false)
    assert.equal(call[2].autoRefreshToken, false)
  }
  const headers = calls.find(([type]) => type === 'fetch')[2]
  assert.equal(headers.get('apikey'), 'anon-key')
  assert.equal(headers.get('sb-forwarded-for'), null)
})

test('only configured trusted IP is forwarded with service apikey and anon authorization', async () => {
  const { calls, handler } = setup({ env: { USERNAME_LOGIN_TRUSTED_IP_HEADER: 'x-verified-ip' } })
  await handler(post(credentials, { 'x-verified-ip': '192.0.2.1', 'sb-forwarded-for': 'spoof' }))
  const headers = calls.find(([type]) => type === 'fetch')[2]
  assert.equal(calls.find(([type]) => type === 'limit')[2].p_verified_ip, '192.0.2.1')
  assert.equal(headers.get('sb-forwarded-for'), '192.0.2.1')
  assert.equal(headers.get('apikey'), 'server-secret')
  assert.equal(headers.get('authorization'), 'Bearer anon-key')
})

for (const [name, overrides] of Object.entries({
  unknown: { missing: true },
  lookupFailure: { lookupError: { message: 'private lookup failure' } },
  adminFailure: { adminError: { message: 'private admin failure' } },
  wrongPassword: { authError: { message: 'private auth failure' } },
  unconfirmed: { authError: { message: 'Email not confirmed' } },
  rateLimited: { authError: { status: 429 } },
  missingSession: { noSession: true },

})) {
  test(`${name} returns identical generic credentials failure`, async () => {
    const { handler, calls } = setup(overrides)
    const response = await handler(post(credentials))
    assert.equal(calls[1][0], 'limit', 'Limiter must precede all privileged lookups')
    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), { error: 'Invalid credentials' })
  })
}

for (const [name, overrides, status] of [
  ['throttled', { allowed: false }, 429],
  ['RPC error', { limitError: { message: 'private database failure' } }, 503],
  ['RPC exception', { limitThrows: true }, 503],
  ['missing RPC result', { allowed: null }, 503],
  ['malformed RPC result', { allowed: 'true' }, 503],
]) {
  test(`${name} fails closed before profile/admin/password lookups`, async () => {
    const { handler, calls } = setup(overrides)
    const response = await handler(post(credentials))
    assert.equal(response.status, status)
    assert.deepEqual(await response.json(), { error: 'Please try again later' })
    assert.equal(response.headers.get('retry-after'), '60')
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(calls.map(([type]) => type), ['client', 'limit'])
  })
}

for (const ip of [undefined, '', 'spoof', '192.0.2.1, 192.0.2.2', '192.0.2.0/24']) {
  test(`configured IP header must contain a single verified IP: ${ip}`, async () => {
    const { handler, calls } = setup({ env: { USERNAME_LOGIN_TRUSTED_IP_HEADER: 'x-verified-ip' } })
    const response = await handler(post(credentials, ip === undefined ? {} : { 'x-verified-ip': ip }))
    assert.equal(response.status, 503)
    assert.equal(calls.length, 0)
  })
}

test('verified IPv6 reaches limiter and Auth', async () => {
  const { handler, calls } = setup({ env: { USERNAME_LOGIN_TRUSTED_IP_HEADER: 'x-verified-ip' } })
  assert.equal((await handler(post(credentials, { 'x-verified-ip': '2001:db8::1' }))).status, 200)
  assert.equal(calls[1][2].p_verified_ip, '2001:db8::1')
})

test('missing server configuration fails closed', async () => {
  const { handler, calls } = setup({ env: { SUPABASE_SERVICE_ROLE_KEY: '' } })
  assert.equal((await handler(post(credentials))).status, 503)
  assert.equal(calls.length, 0)
})

for (const body of [null, [], {}, { username: 'ab', password: 'secret' },
  { username: 'a-b', password: 'secret' }, { username: 'éabc', password: 'secret' },
  { username: 'abc', password: '' }, { username: 'abc', password: 123 },
  { username: 'a'.repeat(25), password: 'secret' }, { username: 'abc', password: 'p'.repeat(1025) }]) {
  test(`invalid credentials rejected without backend calls: ${JSON.stringify(body).slice(0, 80)}`, async () => {
    const { calls, handler } = setup()
    assert.equal((await handler(post(body))).status, 401)
    assert.equal(calls.length, 0)
  })
}

test('method, media type, malformed JSON and both declared/streamed body limits', async () => {
  const { calls, handler } = setup()
  const preflight = await handler(new Request('https://test.invalid', { method: 'OPTIONS' }))
  assert.equal(preflight.status, 200)
  const get = await handler(new Request('https://test.invalid'))
  assert.equal(get.status, 405)
  assert.equal(get.headers.get('allow'), 'POST, OPTIONS')
  assert.equal((await handler(post(credentials, { 'Content-Type': 'text/plain' }))).status, 415)
  assert.equal((await handler(post('{'))).status, 400)
  assert.equal((await handler(post(credentials, { 'Content-Length': '4097' }))).status, 400)
  assert.equal((await handler(post(credentials, { 'Content-Length': 'invalid' }))).status, 400)
  assert.equal((await handler(post(' '.repeat(4097)))).status, 400)
  assert.equal((await handler(post(JSON.stringify({ username: 'abc', password: '😀'.repeat(1024) })))).status, 400)
  assert.equal(calls.length, 0)
})
