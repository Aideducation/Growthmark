import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore'
import { A, B, bootstrap, client, draft, environment, factories, identity, item, meta, oldDate, payment, profile, project, seedWorkspace, settingsFactories, task, workspace } from './helpers.mjs'

let env, a, b
before(async () => { env = await environment(); a = identity(env, A); b = identity(env, B) })
beforeEach(async () => { await env.clearFirestore(); await seedWorkspace(a, A); await seedWorkspace(b, B) })
after(async () => { await env?.cleanup() })
const path = (uid, kind, id = 'record') => `workspaces/${uid}/${kind}/${id}`
const patch = data => ({ ...data, updatedAt: serverTimestamp(), revision: 2 })
async function privilegedSet(path, data) {
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), path), data))
}

test('registration: own missing workspace is readable and profile/workspace bootstrap is atomic', async () => {
  const uid = 'new-freelancer', db = identity(env, uid)
  assert.equal((await assertSucceeds(getDoc(doc(db, `workspaces/${uid}`)))).exists(), false)
  await assertFails(setDoc(doc(db, `users/${uid}`), profile(uid)))
  await assertFails(setDoc(doc(db, `workspaces/${uid}`), workspace(uid)))
  await assertSucceeds(bootstrap(db, uid))
  await assertSucceeds(getDoc(doc(db, `users/${uid}`)))
})
test('Google identity can bootstrap its own workspace', async () => {
  await assertSucceeds(bootstrap(identity(env, 'google-user', { firebase: { sign_in_provider: 'google.com' } }), 'google-user'))
})
test('cannot bootstrap another user or extra workspace', async () => {
  await assertFails(bootstrap(a, 'someone-else'))
  await assertFails(setDoc(doc(a, 'workspaces/extra-workspace'), workspace(A)))
})
test('profile edits require Auth email and cannot inject roles or change linkage', async () => {
  const ref = doc(a, `users/${A}`)
  await assertSucceeds(updateDoc(ref, { fullName: 'Updated', updatedAt: serverTimestamp() }))
  for (const value of [{ role: 'admin' }, { superAdmin: true }, { workspaceId: B }, { userId: B }, { email: 'other@example.test' }, { password: 'not-allowed' }, { createdAt: oldDate }]) {
    await assertFails(updateDoc(ref, { ...value, updatedAt: serverTimestamp() }))
  }
  await assertFails(deleteDoc(ref))
  await assertFails(getDocs(collection(a, 'users')))
})
test('workspace settings cannot change owner, currency, schema or creation time', async () => {
  const ref = doc(a, `workspaces/${A}`)
  await assertSucceeds(updateDoc(ref, { name: 'New name', updatedAt: serverTimestamp() }))
  for (const value of [{ ownerId: B }, { currency: 'USD' }, { schemaVersion: 2 }, { role: 'admin' }, { createdAt: oldDate }]) await assertFails(updateDoc(ref, { ...value, updatedAt: serverTimestamp() }))
  await assertFails(deleteDoc(ref))
  await assertFails(getDocs(collection(a, 'workspaces')))
})

for (const [who, uid, other] of [['A', A, B], ['B', B, A]]) {
  test(`Freelancer ${who}: can read own profile/workspace, not another's`, async () => {
    const db = uid === A ? a : b
    for (const root of ['users', 'workspaces']) {
      await assertSucceeds(getDoc(doc(db, `${root}/${uid}`)))
      await assertFails(getDoc(doc(db, `${root}/${other}`)))
      await assertFails(updateDoc(doc(db, `${root}/${other}`), { name: 'intrusion', updatedAt: serverTimestamp() }))
      await assertFails(deleteDoc(doc(db, `${root}/${other}`)))
    }
  })
  for (const kind of Object.keys(factories)) {
    test(`Freelancer ${who}: ${kind} own access allowed, foreign get/list/create/update/delete denied`, async () => {
      const db = uid === A ? a : b
      const id = kind === 'clients' ? 'client' : kind === 'projects' ? 'project' : 'record'
      await assertSucceeds(getDoc(doc(db, path(uid, kind, id))))
      await assertSucceeds(getDocs(collection(db, `workspaces/${uid}/${kind}`)))
      if(kind==='invoices'&&process.env.GROWTHMARK_RULES_FILE==='firestore.release.rules')await assertFails(setDoc(doc(db,path(uid,kind,'new')),factories[kind](uid)))
      else await assertSucceeds(setDoc(doc(db, path(uid, kind, 'new')), factories[kind](uid)))
      await assertFails(getDoc(doc(db, path(other, kind, id))))
      await assertFails(getDocs(collection(db, `workspaces/${other}/${kind}`)))
      await assertFails(setDoc(doc(db, path(other, kind, 'intrusion')), factories[kind](other)))
      await assertFails(updateDoc(doc(db, path(other, kind, id)), patch({ notes: 'intrusion' })))
      await assertFails(deleteDoc(doc(db, path(other, kind, id))))
    })
  }
  for (const [name, factory] of Object.entries(settingsFactories)) {
    test(`Freelancer ${who}: private ${name} settings isolate reads and writes`, async () => {
      const db = uid === A ? a : b
      await assertSucceeds(getDoc(doc(db, path(uid, 'settings', name))))
      await assertSucceeds(updateDoc(doc(db, path(uid, 'settings', name)), patch({})))
      await assertFails(getDoc(doc(db, path(other, 'settings', name))))
      await assertFails(setDoc(doc(db, path(other, 'settings', name)), factory(other)))
      await assertFails(deleteDoc(doc(db, path(uid, 'settings', name))))
    })
  }
  for (const kind of ['quotations', 'invoices']) {
    test(`Freelancer ${who}: ${kind} item isolation and draft CRUD`, async () => {
      const db = uid === A ? a : b
      const own = path(uid, kind) + '/items/item', foreign = path(other, kind) + '/items/item'
      await assertSucceeds(getDoc(doc(db, own)))
      await assertSucceeds(getDocs(collection(db, path(uid, kind) + '/items')))
      await assertSucceeds(updateDoc(doc(db, own), patch({ quantityMilli: 2000 })))
      await assertFails(getDoc(doc(db, foreign)))
      await assertFails(updateDoc(doc(db, foreign), patch({ quantityMilli: 2000 })))
      await assertFails(deleteDoc(doc(db, foreign)))
      await assertSucceeds(deleteDoc(doc(db, own)))
    })
  }
}

for (const kind of Object.keys(factories)) {
  test(`${kind}: create rejects forged ownership, unknown fields, omitted fields, timestamps and bad revisions`, async () => {
    const mutations = [{ ownerId: B }, { workspaceId: B }, { admin: true }, { schemaVersion: 2 }, { createdAt: oldDate }, { updatedAt: oldDate }, { revision: 3 }, { revision: 1.5 }]
    for (const value of mutations) await assertFails(setDoc(doc(a, path(A, kind, 'invalid')), { ...factories[kind](A), ...value }))
    const incomplete = factories[kind](A); delete incomplete.ownerId
    await assertFails(setDoc(doc(a, path(A, kind, 'invalid')), incomplete))
  })
}
test('record updates preserve metadata and require sequential integer revision', async () => {
  const ref = doc(a, path(A, 'clients', 'client'))
  for (const value of [{ ownerId: B }, { workspaceId: B }, { createdAt: oldDate }, { schemaVersion: 2 }, { revision: 1 }, { revision: 2.5 }, { updatedAt: oldDate }]) await assertFails(updateDoc(ref, { ...patch({}), ...value }))
  await assertSucceeds(updateDoc(ref, patch({ name: 'Updated client', status: 'archived' })))
})
test('client validation rejects wrong types, blank names, oversized notes and unknown status', async () => {
  for (const value of [{ name: '' }, { email: 123 }, { notes: 'x'.repeat(5001) }, { status: 'superuser' }]) await assertFails(setDoc(doc(a, path(A, 'clients', 'bad')), { ...client(A), ...value }))
})
test('project references must exist locally, client is immutable and budgets/dates/progress valid', async () => {
  await setDoc(doc(b, path(B, 'clients', 'only-b')), client(B))
  for (const value of [{ clientId: 'only-b' }, { budgetMinor: -1 }, { budgetMinor: 1.5 }, { progressPercent: 101 }, { startAt: Timestamp.now(), deadlineAt: oldDate }]) await assertFails(setDoc(doc(a, path(A, 'projects', 'bad')), { ...project(A), ...value }))
  await setDoc(doc(a, path(A, 'clients', 'second')), client(A))
  await assertFails(updateDoc(doc(a, path(A, 'projects', 'project')), patch({ clientId: 'second' })))
  await assertSucceeds(updateDoc(doc(a, path(A, 'projects', 'project')), patch({ status: 'completed', progressPercent: 100 })))
})
test('tasks validate local project/client pairs and support unlinked tasks', async () => {
  await setDoc(doc(a, path(A, 'clients', 'second')), client(A))
  for (const value of [{ clientId: 'second' }, { clientId: null }, { projectId: 'missing' }, { status: 'paid' }, { priority: 'admin' }, { dueAt: 'tomorrow' }]) await assertFails(setDoc(doc(a, path(A, 'tasks', 'bad')), { ...task(A), ...value }))
  await assertSucceeds(setDoc(doc(a, path(A, 'tasks', 'unlinked')), { ...task(A), clientId: null, projectId: null }))
  await assertSucceeds(updateDoc(doc(a, path(A, 'tasks')), patch({ status: 'completed' })))
})
for (const [name, factory] of Object.entries(settingsFactories)) {
  test(`${name} settings reject injected fields and wrong types`, async () => {
    const ref = doc(a, path(A, 'settings', name))
    await assertFails(updateDoc(ref, patch({ gatewaySecret: 'forbidden' })))
    const d = factory(A)
    const field = name === 'business' ? 'name' : name === 'payment' ? 'accountNumber' : 'defaultTaxBps'
    await assertFails(updateDoc(ref, patch({ [field]: name === 'invoice' ? 10001 : 123 })))
    assert.ok(d.ownerId === A)
  })
}
for (const kind of ['quotations', 'invoices']) {
  test(`${kind}: rejects issuance, totals, payment status and invalid dates`, async () => {
    for (const value of [{ number: 'INV-1' }, { grandTotalMinor: 100 }, { amountPaidMinor: 100 }, { verified: true }, { state: 'issued' }, { status: 'paid' }, { issuedSnapshot: {} }, { dueAt: Timestamp.fromMillis(0) }]) await assertFails(setDoc(doc(a, path(A, kind, 'bad')), { ...draft(A), ...value }))
    await assertSucceeds(updateDoc(doc(a, path(A, kind)), patch({ title: 'Edited draft' })))
    await assertFails(deleteDoc(doc(a, path(A, kind))))
  })
  test(`${kind}: archived parent locks document and items, including atomic archive+item bypass`, async () => {
    const batch = writeBatch(a)
    batch.update(doc(a, path(A, kind)), patch({ state: 'archived' }))
    batch.update(doc(a, path(A, kind) + '/items/item'), patch({ unitPriceMinor: 1 }))
    await assertFails(batch.commit())
    await assertSucceeds(updateDoc(doc(a, path(A, kind)), patch({ state: 'archived' })))
    await assertFails(updateDoc(doc(a, path(A, kind)), { ...patch({ state: 'draft' }), revision: 3 }))
    await assertFails(updateDoc(doc(a, path(A, kind) + '/items/item'), patch({ unitPriceMinor: 1 })))
    await assertFails(deleteDoc(doc(a, path(A, kind) + '/items/item')))
    await assertFails(setDoc(doc(a, path(A, kind) + '/items/new'), item(A)))
  })
  test(`${kind}: items reject totals, wrong types, invalid numeric ranges and absent parent`, async () => {
    for (const value of [{ ownerId: B }, { totalMinor: 1 }, { quantityMilli: 0 }, { quantityMilli: 1.5 }, { unitPriceMinor: -1 }, { taxRateBps: 10001 }, { discountBps: -1 }, { description: '' }]) await assertFails(setDoc(doc(a, path(A, kind) + '/items/bad'), { ...item(A), ...value }))
    await assertFails(setDoc(doc(a, path(A, kind, 'missing') + '/items/new'), item(A)))
  })
}
test('manual payments reject verification claims, negative/fractional amounts, currency mismatch and future dates', async () => {
  for (const value of [{ verified: true }, { source: 'gateway' }, { method: 'online-gateway' }, { invoiceId: 'record' }, { amountMinor: 0 }, { amountMinor: -1 }, { amountMinor: 1.2 }, { currency: 'USD' }, { paidAt: Timestamp.fromDate(new Date('2999-01-01')) }, { transactionReference: 123 }, { clientId: 'missing' }]) await assertFails(setDoc(doc(a, path(A, 'payments', 'bad')), { ...payment(A), ...value }))
})
test('payment history cannot be updated, replaced or deleted even by its owner', async () => {
  const ref = doc(a, path(A, 'payments'))
  await assertFails(updateDoc(ref, patch({ amountMinor: 1 })))
  await assertFails(setDoc(ref, payment(A)))
  await assertFails(deleteDoc(ref))
})
test('transaction retries with one payment ID create exactly one immutable record', async () => {
  const ref = doc(a, path(A, 'payments', 'submission-id'))
  async function record() { return runTransaction(a, async transaction => {
    const existing = await transaction.get(ref)
    if (existing.exists()) return 'existing'
    const clientRef = doc(a, path(A, 'clients', 'client'))
    assert.equal((await transaction.get(clientRef)).exists(), true)
    transaction.set(ref, payment(A)); return 'created'
  }) }
  assert.deepEqual((await Promise.all([record(), record()])).sort(), ['created', 'existing'])
  assert.equal((await getDoc(ref)).data().amountMinor, 5000)
})

for (const mode of ['anonymous', 'unverified', 'missing-verification', 'unsupported-provider', 'suspended', 'malformed-access']) {
  test(`${mode}: private reads, onboarding and record writes denied`, async () => {
    let db
    if (mode === 'anonymous') db = env.unauthenticatedContext().firestore()
    else if (mode === 'unverified') db = identity(env, A, { email_verified: false })
    else if (mode === 'missing-verification') db = env.authenticatedContext(A, { email: `${A}@example.test`, firebase: { sign_in_provider: 'password' } }).firestore()
    else if (mode === 'unsupported-provider') db = identity(env, A, { firebase: { sign_in_provider: 'custom' } })
    else {
      await privilegedSet(`accountAccess/${A}`, mode === 'suspended' ? { userId: A, status: 'suspended' } : { userId: A })
      db = a
    }
    for (const p of [`users/${A}`, `workspaces/${A}`, path(A, 'clients', 'client'), path(A, 'settings', 'payment')]) await assertFails(getDoc(doc(db, p)))
    await assertFails(setDoc(doc(db, path(A, 'clients', 'new')), client(A)))
    await assertFails(updateDoc(doc(db, `workspaces/${A}`), { name: 'blocked', updatedAt: serverTimestamp() }))
    await assertFails(bootstrap(db, A))
  })
}
test('active override works; suspension immediately affects an existing context and cannot be self-removed', async () => {
  await privilegedSet(`accountAccess/${A}`, { userId: A, status: 'active' })
  await assertSucceeds(getDoc(doc(a, path(A, 'clients', 'client'))))
  await privilegedSet(`accountAccess/${A}`, { userId: A, status: 'suspended' })
  await assertFails(getDoc(doc(a, path(A, 'clients', 'client'))))
  await assertSucceeds(getDoc(doc(a, `accountAccess/${A}`)))
  await assertFails(updateDoc(doc(a, `accountAccess/${A}`), { status: 'active' }))
  await assertFails(deleteDoc(doc(a, `accountAccess/${A}`)))
})

for (const p of [
  'publicLinks/unguessable-token', `platformAdmins/${A}`, `platformAccounts/${A}`, 'platformStats/current', 'platformAuditEvents/event', 'gatewayEvents/event', `accountAccess/${A}`,
  ...['counters', 'documentNumbers', 'operationKeys', 'auditEvents', 'billingPeriods', 'reportSummaries', 'retainers', 'unknown'].map(kind => path(A, kind)),
  path(A, 'settings', 'unknown'), path(A, 'clients', 'client') + '/unknown/nested', 'unknown/path',
]) {
  test(`restricted path denied: ${p}`, async () => {
    // Seed an actual document locally so a denial is not confused with absence.
    await privilegedSet(p, { marker: 'restricted-local-fixture' })
    const anon = env.unauthenticatedContext().firestore()
    if (p !== `accountAccess/${A}`) await assertFails(getDoc(doc(a, p)))
    await assertFails(getDoc(doc(anon, p)))
    await assertFails(setDoc(doc(a, p), { role: 'superAdmin' }))
    await assertFails(deleteDoc(doc(a, p)))
  })
}
test('even a simulated admin claim does not grant cross-workspace or platform access in Stage 1', async () => {
  const fakeAdmin = identity(env, A, { superAdmin: true })
  await assertFails(getDoc(doc(fakeAdmin, `workspaces/${B}`)))
  await assertFails(getDoc(doc(fakeAdmin, 'platformStats/current')))
  await assertFails(setDoc(doc(fakeAdmin, `platformAdmins/${A}`), { status: 'active' }))
})
test('cross-workspace collection-group queries and settings enumeration are denied', async () => {
  await assertFails(getDocs(collectionGroup(a, 'clients')))
  await assertFails(getDocs(collection(a, `workspaces/${A}/settings`)))
})
