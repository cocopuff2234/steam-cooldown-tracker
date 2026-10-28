import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/supabase.ts', import.meta.url), 'utf8')
  .replaceAll('import.meta.env', '({ VITE_SUPABASE_URL: "https://example.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "public-key" })')
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function loadClient(url, initializationError = null) {
  let listener
  const events = []
  const window = { location: { href: url, hash: new URL(url).hash } }
  const exports = {}
  const auth = {
    onAuthStateChange(callback) {
      listener = callback
      events.push('subscribed')
      return { data: { subscription: { unsubscribe() {} } } }
    },
    initialize() {
      events.push('initialize')
      return Promise.resolve({ error: initializationError })
    },
  }
  vm.runInNewContext(code, {
    exports,
    URL,
    URLSearchParams,
    window,
    require: () => ({
      createClient() {
        // Model automatic initialization consuming the hash before React mounts.
        window.location.hash = ''
        return { auth }
      },
    }),
  })
  return { exports, events, emit: (event, session) => listener(event, session) }
}

const session = { user: { id: 'recovering-user' } }

test('captures a hash-only recovery callback before client initialization consumes it', () => {
  const client = loadClient('https://app.test/#access_token=test&type=recovery')
  assert.equal(client.exports.recoveryRequested, true)
  assert.deepEqual(client.events, ['subscribed', 'initialize'])
})

test('recognizes app-generated recovery query links', () => {
  assert.equal(loadClient('https://app.test/?auth=reset-password').exports.recoveryRequested, true)
  assert.equal(loadClient('https://app.test/').exports.recoveryRequested, false)
})

test('a stored session or manually supplied query marker does not authorize recovery', () => {
  const client = loadClient('https://app.test/?auth=reset-password')
  client.emit('INITIAL_SESSION', session)
  assert.equal(client.exports.getRecoveryUserId(), null)
  client.emit('SIGNED_IN', session)
  assert.equal(client.exports.getRecoveryUserId(), null)
})

test('retains a successful recovery event received before React mounts', () => {
  const client = loadClient('https://app.test/?auth=reset-password')
  client.emit('PASSWORD_RECOVERY', session)
  client.emit('INITIAL_SESSION', session)
  client.emit('TOKEN_REFRESHED', session)
  client.emit('SIGNED_IN', session)
  assert.equal(client.exports.getRecoveryUserId(), session.user.id)
})

test('signout and a new non-recovery signin clear recovery authorization', () => {
  const client = loadClient('https://app.test/?auth=reset-password')
  client.emit('PASSWORD_RECOVERY', session)
  client.emit('SIGNED_OUT', null)
  assert.equal(client.exports.getRecoveryUserId(), null)
  client.emit('PASSWORD_RECOVERY', session)
  client.emit('SIGNED_IN', { user: { id: 'another-user' } })
  assert.equal(client.exports.getRecoveryUserId(), null)
})

test('initialization errors are retained for the recovery screen', async () => {
  const error = new Error('Reset link expired')
  const client = loadClient('https://app.test/?auth=reset-password', error)
  assert.equal((await client.exports.authInitialization).error, error)
  assert.equal(client.exports.getRecoveryUserId(), null)
})
