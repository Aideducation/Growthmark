import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, deleteApp } from 'firebase/app'
import { applyActionCode, confirmPasswordReset, connectAuthEmulator, getAuth, reload, signInWithCredential, GoogleAuthProvider, verifyPasswordResetCode } from 'firebase/auth'
import { collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore, setDoc, terminate, updateDoc } from 'firebase/firestore'
import { assertFails } from '@firebase/rules-unit-testing'
import { bootstrap, environment, PROJECT, requireEmulators } from './helpers.mjs'
// Exercise the SAME application services used by React, with native Node TypeScript support.
import { loginWithEmail, logout, refreshVerification, registerWithEmail, requireLocalAuth, resendVerification, resetPassword } from '../../src/features/auth/auth-api.ts'
import { completeOnboarding, readOwnerWorkspace } from '../../src/features/auth/workspace-service.ts'

let env, a, b
const apps = []
function local(name) {
  requireEmulators()
  const app = initializeApp({ apiKey: 'demo-emulator-only', projectId: PROJECT, authDomain: 'localhost' }, name)
  const auth = getAuth(app), db = getFirestore(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9199', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8180)
  const value = { app, auth, db }; apps.push(value); return value
}
async function codeFor(email, type) {
  const response = await fetch(`http://127.0.0.1:9199/emulator/v1/projects/${PROJECT}/oobCodes`)
  assert.equal(response.status, 200)
  const result = (await response.json()).oobCodes.findLast(code => code.email === email && code.requestType === type)
  assert.ok(result); return result.oobCode
}
async function verify(bundle) {
  const code = await codeFor(bundle.auth.currentUser.email, 'VERIFY_EMAIL')
  await applyActionCode(bundle.auth, code)
  assert.equal(await refreshVerification(bundle.auth), true)
}
before(async () => {
  env = await environment(); await env.clearFirestore()
  const cleared = await fetch(`http://127.0.0.1:9199/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })
  assert.equal(cleared.status, 200)
  a = local('phase2-a'); b = local('phase2-b')
})
after(async () => {
  for (const bundle of apps) { await terminate(bundle.db); await deleteApp(bundle.app) }
  await env?.cleanup()
})
test('Phase 2: local mutation guard rejects an unconnected or real-project Auth instance', async () => {
  for (const projectId of [PROJECT, 'growthmark-c0e9c']) {
    const app = initializeApp({ apiKey: 'test-not-real', projectId }, `blocked-${projectId}`)
    try {
      assert.throws(() => requireLocalAuth(getAuth(app)), /Live authentication is disabled/)
      await assert.rejects(registerWithEmail(getAuth(app), { fullName: 'No writes', email: 'blocked@example.test', password: 'Local-test-only-123!' }), /Live authentication is disabled/)
    } finally { await deleteApp(app) }
  }
})
test('Phase 2: service registers A, sends verification, and refuses unverified workspace access', async () => {
  const user = await registerWithEmail(a.auth, { fullName: 'Freelancer A', email: 'phase2-a@example.test', password: 'Local-A-password-123!' })
  assert.equal(user.displayName, 'Freelancer A')
  assert.equal(await refreshVerification(a.auth), false)
  await assert.rejects(readOwnerWorkspace(a.auth, a.db), /Verify your email/)
  await assert.rejects(completeOnboarding(a.auth, a.db, { ownerName: 'A', businessName: 'A business' }), /Verify your email/)
  await resendVerification(a.auth)
  await verify(a)
  assert.equal(await readOwnerWorkspace(a.auth, a.db), null)
})
test('Phase 2: service registers and verifies a separate Freelancer B', async () => {
  await registerWithEmail(b.auth, { fullName: 'Freelancer B', email: 'phase2-b@example.test', password: 'Local-B-password-123!' })
  await verify(b)
  assert.notEqual(a.auth.currentUser.uid, b.auth.currentUser.uid)
  assert.equal(await readOwnerWorkspace(b.auth, b.db), null)
})
test('Phase 2: concurrent onboarding creates one UID-owned workspace and one profile', async () => {
  const input = { ownerName: 'Freelancer A', businessName: 'A independent business' }
  const [first, second] = await Promise.all([completeOnboarding(a.auth, a.db, input), completeOnboarding(a.auth, a.db, input)])
  assert.deepEqual(first, second)
  assert.equal(first.workspace.id, a.auth.currentUser.uid)
  assert.equal(first.workspace.ownerId, a.auth.currentUser.uid)
  assert.equal(first.profile.userId, a.auth.currentUser.uid)
  assert.equal(first.workspace.onboarding, 'complete')
  assert.equal(first.workspace.name, input.businessName)
  await env.withSecurityRulesDisabled(async context => {
    assert.equal((await getDocs(collection(context.firestore(), 'workspaces'))).size, 1)
    assert.equal((await getDocs(collection(context.firestore(), 'users'))).size, 1)
  })
})
test('Phase 2: repeat onboarding preserves names and immutable creation timestamps', async () => {
  const before = await readOwnerWorkspace(a.auth, a.db)
  const after = await completeOnboarding(a.auth, a.db, { ownerName: 'Do not overwrite', businessName: 'Do not replace' })
  assert.deepEqual(after, before)
})
test('Phase 2: B onboarding and service reads never expose A; injected IDs are ignored', async () => {
  const result = await completeOnboarding(b.auth, b.db, { ownerName: 'Freelancer B', businessName: 'B private business', ownerId: a.auth.currentUser.uid, workspaceId: a.auth.currentUser.uid, admin: true })
  assert.equal(result.workspace.ownerId, b.auth.currentUser.uid)
  assert.equal((await readOwnerWorkspace(a.auth, a.db)).workspace.name, 'A independent business')
  await assertFails(getDoc(doc(b.db, 'workspaces', a.auth.currentUser.uid)))
  await assertFails(getDoc(doc(a.db, 'users', b.auth.currentUser.uid)))
  const raw = (await getDoc(doc(b.db, 'users', b.auth.currentUser.uid))).data()
  assert.equal('admin' in raw, false)
})
test('Phase 2: a fresh Auth client logs in to the same UID and skips completed onboarding', async () => {
  const fresh = local('phase2-fresh-session')
  await loginWithEmail(fresh.auth, 'phase2-a@example.test', 'Local-A-password-123!')
  const records = await readOwnerWorkspace(fresh.auth, fresh.db)
  assert.equal(records.workspace.id, a.auth.currentUser.uid)
  assert.equal(records.workspace.onboarding, 'complete')
})
test('Phase 2: invalid onboarding names fail before changing existing records', async () => {
  const before = await readOwnerWorkspace(a.auth, a.db)
  for (const input of [{ ownerName: '', businessName: 'Business' }, { ownerName: 'A', businessName: 'x'.repeat(161) }]) await assert.rejects(completeOnboarding(a.auth, a.db, input), /1 to 160/)
  assert.deepEqual(await readOwnerWorkspace(a.auth, a.db), before)
})
test('Phase 2: suspended account cannot use application workspace services', async () => {
  const uid = a.auth.currentUser.uid
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'accountAccess', uid), { userId: uid, status: 'suspended' }))
  try {
    await assert.rejects(readOwnerWorkspace(a.auth, a.db))
    await assert.rejects(completeOnboarding(a.auth, a.db, { ownerName: 'A', businessName: 'No access' }))
  } finally {
    await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'accountAccess', uid), { status: 'active' }))
  }
})
test('Phase 2: application validates stored ownership instead of trusting the document path', async () => {
  const uid = a.auth.currentUser.uid
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'workspaces', uid), { ownerId: b.auth.currentUser.uid }))
  try { await assert.rejects(readOwnerWorkspace(a.auth, a.db), /could not be validated/) }
  finally { await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'workspaces', uid), { ownerId: uid })) }
})
test('Phase 2: interrupted initial business setup resumes without replacing creation timestamps', async () => {
  const bundle = local('phase2-resume')
  const user = await registerWithEmail(bundle.auth, { fullName: 'Resume owner', email: 'phase2-resume@example.test', password: 'Local-resume-123!' })
  await verify(bundle)
  await bootstrap(bundle.db, user.uid, user.email)
  const before = await readOwnerWorkspace(bundle.auth, bundle.db)
  assert.equal(before.workspace.onboarding, 'business-profile')
  const after = await completeOnboarding(bundle.auth, bundle.db, { ownerName: 'Resume owner', businessName: 'Resumed business' })
  assert.equal(after.workspace.onboarding, 'complete')
  assert.equal(after.workspace.createdAt, before.workspace.createdAt)
  assert.equal(after.profile.createdAt, before.profile.createdAt)
})
test('Phase 2: password reset service generates a usable local code and new password login works', async () => {
  await resetPassword(b.auth, 'phase2-b@example.test')
  const code = await codeFor('phase2-b@example.test', 'PASSWORD_RESET')
  assert.equal(await verifyPasswordResetCode(b.auth, code), 'phase2-b@example.test')
  await confirmPasswordReset(b.auth, code, 'Local-B-new-password-456!')
  const uid = b.auth.currentUser.uid
  await logout(b.auth)
  await assert.rejects(loginWithEmail(b.auth, 'phase2-b@example.test', 'Local-B-password-123!'))
  await loginWithEmail(b.auth, 'phase2-b@example.test', 'Local-B-new-password-456!')
  await reload(b.auth.currentUser)
  assert.equal(b.auth.currentUser.uid, uid)
  assert.equal((await readOwnerWorkspace(b.auth, b.db)).workspace.name, 'B private business')
})
test('Phase 2: Google provider token supports the same UID-derived onboarding service', async () => {
  const bundle = local('phase2-google')
  const credential = GoogleAuthProvider.credential(JSON.stringify({ sub: 'phase2-google-owner', email: 'phase2-google@example.test', email_verified: true, name: 'Google freelancer' }))
  await signInWithCredential(bundle.auth, credential)
  const result = await completeOnboarding(bundle.auth, bundle.db, { ownerName: 'Google freelancer', businessName: 'Google business' })
  assert.equal(result.workspace.id, bundle.auth.currentUser.uid)
  await assertFails(getDoc(doc(bundle.db, 'workspaces', a.auth.currentUser.uid)))
})
test('Phase 2: logout blocks workspace services and subsequent Firestore access', async () => {
  const uid = a.auth.currentUser.uid
  await logout(a.auth)
  assert.equal(a.auth.currentUser, null)
  await assert.rejects(readOwnerWorkspace(a.auth, a.db), /Sign in/)
  await assertFails(getDoc(doc(a.db, 'workspaces', uid)))
})
