import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useFirebaseEmulators, registerLiveFirebase, isSelectedLiveAuth, requireMatchingFirebase } from '../../src/services/firebase-mode.ts'
import { requireLocalAuth } from '../../src/features/auth/auth-api.ts'

test('Firebase mode defaults safely to emulators and only explicit false selects real', () => {
  for (const value of [undefined, '', 'true', ' true ']) assert.equal(useFirebaseEmulators(value), true)
  assert.equal(useFirebaseEmulators('false'), false)
  for (const value of ['FALSE', '0', 'yes']) assert.throws(() => useFirebaseEmulators(value))
})
test('Configured real pair is allowed without contacting Firebase; unrelated instances remain blocked', () => {
  const app = { options: { projectId: 'environment-selected-project' } }
  const auth = { app }, db = { app }
  assert.throws(() => requireLocalAuth(auth))
  registerLiveFirebase(auth, db)
  assert.equal(isSelectedLiveAuth(auth), true)
  assert.doesNotThrow(() => requireLocalAuth(auth))
  assert.doesNotThrow(() => requireMatchingFirebase(auth, db))
  assert.throws(() => requireMatchingFirebase(auth, { app }))
  assert.throws(() => requireMatchingFirebase(auth, { app: { options: app.options } }))
  assert.throws(() => registerLiveFirebase({ app, emulatorConfig: { host: '127.0.0.1' } }, db))
  const demo = { options: { projectId: 'demo-only' } }
  assert.throws(() => registerLiveFirebase({ app: demo }, { app: demo }))
})
