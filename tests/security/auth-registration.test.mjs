import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, deleteApp } from 'firebase/app'
import { applyActionCode, connectAuthEmulator, createUserWithEmailAndPassword, getAuth, GoogleAuthProvider, reload, sendEmailVerification, signInWithCredential, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { connectFirestoreEmulator, doc, getDoc, getFirestore, terminate } from 'firebase/firestore'
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { bootstrap, environment, PROJECT, requireEmulators } from './helpers.mjs'

let env, first, second
const apps = []
function localApp(name) {
  requireEmulators()
  const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-emulator-only', authDomain: 'localhost' }, name)
  const auth = getAuth(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9199', { disableWarnings: true })
  const db = getFirestore(app)
  connectFirestoreEmulator(db, '127.0.0.1', 8180)
  const bundle = { app, auth, db }; apps.push(bundle); return bundle
}
async function verifyEmail(bundle) {
  await sendEmailVerification(bundle.auth.currentUser)
  const response = await fetch(`http://127.0.0.1:9199/emulator/v1/projects/${PROJECT}/oobCodes`)
  assert.equal(response.status, 200)
  const { oobCodes } = await response.json()
  const code = oobCodes.findLast(code => code.email === bundle.auth.currentUser.email && code.requestType === 'VERIFY_EMAIL')
  assert.ok(code, 'Auth emulator must produce a verification code')
  await applyActionCode(bundle.auth, code.oobCode)
  await reload(bundle.auth.currentUser)
  await bundle.auth.currentUser.getIdToken(true)
}
before(async () => {
  env = await environment()
  await env.clearFirestore()
  const response = await fetch(`http://127.0.0.1:9199/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })
  assert.equal(response.status, 200)
  first = localApp('auth-registration-a'); second = localApp('auth-registration-b')
})
after(async () => {
  for (const bundle of apps) { await terminate(bundle.db); await deleteApp(bundle.app) }
  await env?.cleanup()
})
test('real Auth emulator: Freelancer A registers, must verify email, then provisions one workspace', async () => {
  const result = await createUserWithEmailAndPassword(first.auth, 'freelancer-a@example.test', 'Emulator-only-pass-1!')
  assert.equal(result.user.emailVerified, false)
  await assertFails(bootstrap(first.db, result.user.uid, result.user.email))
  await verifyEmail(first)
  await assertSucceeds(bootstrap(first.db, result.user.uid, result.user.email))
  assert.equal((await getDoc(doc(first.db, `workspaces/${result.user.uid}`))).data().ownerId, result.user.uid)
})
test('real Auth emulator: Freelancer B registers independently and cannot access A', async () => {
  const result = await createUserWithEmailAndPassword(second.auth, 'freelancer-b@example.test', 'Emulator-only-pass-2!')
  await verifyEmail(second)
  await assertSucceeds(bootstrap(second.db, result.user.uid, result.user.email))
  assert.notEqual(result.user.uid, first.auth.currentUser.uid)
  await assertFails(getDoc(doc(second.db, `workspaces/${first.auth.currentUser.uid}`)))
  await assertFails(getDoc(doc(first.db, `workspaces/${result.user.uid}`)))
})
test('real Auth emulator: logout removes workspace access and password login restores the same identity', async () => {
  const uid = first.auth.currentUser.uid
  await signOut(first.auth)
  await assertFails(getDoc(doc(first.db, `workspaces/${uid}`)))
  await assert.rejects(signInWithEmailAndPassword(first.auth, 'freelancer-a@example.test', 'Wrong-emulator-password'))
  const result = await signInWithEmailAndPassword(first.auth, 'freelancer-a@example.test', 'Emulator-only-pass-1!')
  assert.equal(result.user.uid, uid)
  await assertSucceeds(getDoc(doc(first.db, `workspaces/${uid}`)))
})
test('real Auth emulator: verified Google credential can provision a separate workspace', async () => {
  const bundle = localApp('auth-registration-google')
  // The Auth emulator accepts unsigned JSON credentials. This is never used against live Auth.
  const credential = GoogleAuthProvider.credential(JSON.stringify({ sub: 'local-google-freelancer', email: 'google@example.test', email_verified: true, name: 'Google emulator account' }))
  const result = await signInWithCredential(bundle.auth, credential)
  assert.equal(result.user.emailVerified, true)
  await assertSucceeds(bootstrap(bundle.db, result.user.uid, result.user.email))
  await assertFails(getDoc(doc(bundle.db, `workspaces/${first.auth.currentUser.uid}`)))
})
