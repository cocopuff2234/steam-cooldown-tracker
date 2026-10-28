import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function compile(path) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
}

const usersModule = { exports: {} }
vm.runInNewContext(compile('../src/users.ts'), { exports: usersModule.exports })
const { users } = usersModule.exports
const authCode = compile('../src/auth.ts')

function loadAuth({ legacyError = null, endpointError = null, tokens, sessionError = null } = {}) {
  const calls = []
  const supabase = {
    auth: {
      async signInWithPassword(credentials) {
        calls.push({ method: 'password', ...credentials })
        return { error: legacyError }
      },
      async setSession(session) {
        calls.push({ method: 'session', ...session })
        return { error: sessionError }
      },
    },
    functions: {
      async invoke(name, options) {
        calls.push({ method: 'function', name, ...options.body })
        return {
          data: tokens ?? { access_token: 'access', refresh_token: 'refresh' },
          error: endpointError,
        }
      },
    },
  }
  const exports = {}
  vm.runInNewContext(authCode, {
    exports,
    require: (name) => name === './users' ? { users } : { supabase },
  })
  return { ...exports, calls }
}

for (const username of ['rio', 'myrka']) {
  test(`${username} authenticates against its original email without depending on the new endpoint`, async () => {
    const auth = loadAuth({ endpointError: { context: { status: 404 } } })
    await auth.signInWithUsername(` ${username.toUpperCase()} `, ' original password ')
    assert.deepEqual(auth.calls, [{ method: 'password', email: users[username], password: ' original password ' }])
  })
}

test('a wrong legacy password is rejected and never tries another identity or endpoint', async () => {
  const auth = loadAuth({ legacyError: { message: 'Invalid login credentials' } })
  await assert.rejects(auth.signInWithUsername('rio', 'incorrect'), /Incorrect username or password/)
  assert.equal(auth.calls.length, 1)
  assert.equal(auth.calls[0].method, 'password')
})

test('new users sign in with normalized usernames, not emails, and install the returned session', async () => {
  const auth = loadAuth()
  await auth.signInWithUsername(' New_User ', 'password')
  assert.deepEqual(auth.calls, [
    { method: 'function', name: 'username-login', username: 'new_user', password: 'password' },
    { method: 'session', access_token: 'access', refresh_token: 'refresh' },
  ])
})

test('email addresses cannot be submitted as login usernames', async () => {
  const auth = loadAuth()
  await assert.rejects(auth.signInWithUsername('email@example.com', 'password'), /Incorrect username or password/)
  assert.equal(auth.calls.length, 0)
})

test('inherited object properties are not treated as legacy identities', async () => {
  const auth = loadAuth()
  await auth.signInWithUsername('constructor', 'password')
  assert.equal(auth.calls[0].method, 'function')
})

test('throttled and unavailable endpoints do not install sessions', async () => {
  for (const [status, message] of [[429, /Too many login attempts/], [503, /currently unavailable/], [404, /currently unavailable/]]) {
    const auth = loadAuth({ endpointError: { context: { status } } })
    await assert.rejects(auth.signInWithUsername('new_user', 'password'), message)
    assert.equal(auth.calls.length, 1)
  }
})

test('invalid endpoint tokens do not install sessions', async () => {
  const auth = loadAuth({ tokens: { access_token: 123, refresh_token: 'refresh' } })
  await assert.rejects(auth.signInWithUsername('new_user', 'password'), /Incorrect username or password/)
  assert.equal(auth.calls.length, 1)
})

test('new accounts have a normalized dashboard display name before a profile is available', () => {
  const auth = loadAuth()
  assert.equal(auth.getFallbackUsername({ email: 'new@example.com', user_metadata: { username: ' New_User ' } }), 'new_user')
  assert.equal(auth.getFallbackUsername({ email: 'new@example.com', user_metadata: { username: 'invalid name' } }), '')
})

test('legacy accounts retain dashboard names even without profiles or username metadata', () => {
  const auth = loadAuth()
  for (const username of ['rio', 'myrka']) {
    assert.equal(auth.getFallbackUsername({ email: users[username].toUpperCase(), user_metadata: {} }), username)
  }
})

test('auth fields follow the title width without error messages affecting intrinsic sizing', () => {
  const css = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')
  assert.match(css, /\.login-panel\s*\{[^}]*width:\s*max-content;/)
  for (const selector of ['login-form', 'login-actions', 'login-footer']) {
    assert.match(css, new RegExp(`\\.${selector}\\s*\\{[^}]*contain:\\s*inline-size;[^}]*width:\\s*100%;`))
  }
  assert.match(css, /\.login-panel\s*\{[^}]*max-width:\s*calc\(100% - 76px\);/)
  assert.match(css, /\.login-panel \.error\s*\{[^}]*overflow-wrap:\s*anywhere;/)
  assert.match(css, /\.login-panel \.error\s*\{[^}]*margin:\s*0;/)
  assert.match(css, /\.login-footer\s*\{[^}]*gap:\s*6px;/)
})

test('email rate limits have a clear message without suggesting a wrong password', () => {
  const auth = loadAuth()
  for (const error of [
    { code: 'over_email_send_rate_limit', message: 'Email rate limit exceeded' },
    { message: 'email rate limit exceeded' },
  ]) {
    assert.equal(auth.getAuthErrorMessage(error), 'Email sending limit reached. Please try again later.')
  }
  assert.equal(auth.getAuthErrorMessage({ message: 'Other error' }), 'Other error')
})
