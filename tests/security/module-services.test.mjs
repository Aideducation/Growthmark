import { before, beforeEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, deleteApp } from 'firebase/app'
import { applyActionCode, connectAuthEmulator, getAuth } from 'firebase/auth'
import { collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore, terminate } from 'firebase/firestore'
import { assertFails } from '@firebase/rules-unit-testing'
import { environment, PROJECT, requireEmulators } from './helpers.mjs'
import { registerWithEmail, refreshVerification } from '../../src/features/auth/auth-api.ts'
import { completeOnboarding, readOwnerWorkspace } from '../../src/features/auth/workspace-service.ts'
import { archiveRecord, saveAccount, saveDraftItem, saveRecord, saveSettings } from '../../src/features/workspace/record-service.ts'
import { entityFields, inputValues, settingsFields } from '../../src/features/workspace/schema.ts'
import { calculateDocument, calculateLine, scaledInteger } from '../../src/features/workspace/money.ts'

let env, a, b, aClient, aProject, bClient
const apps = []
async function account(name) {
  requireEmulators()
  const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-emulator-only' }, `modules-${name}`), auth = getAuth(app), db = getFirestore(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9199', { disableWarnings: true }); connectFirestoreEmulator(db, '127.0.0.1', 8180)
  const value = { app, auth, db }; apps.push(value)
  const user = await registerWithEmail(auth, { fullName: name, email: `modules-${name}@example.test`, password: 'Local-modules-test-123!' })
  const response = await fetch(`http://127.0.0.1:9199/emulator/v1/projects/${PROJECT}/oobCodes`)
  assert.equal(response.status, 200)
  const code = (await response.json()).oobCodes.findLast(code => code.email === user.email && code.requestType === 'VERIFY_EMAIL')
  await applyActionCode(auth, code.oobCode); await refreshVerification(auth)
  return value
}
const values = (kind, extra) => ({ ...inputValues(entityFields[kind]), ...extra })
const ref = (bundle, kind, id) => doc(bundle.db, 'workspaces', bundle.auth.currentUser.uid, kind, id)
before(async () => { env = await environment(); a = await account('a'); b = await account('b') })
beforeEach(async () => {
  await env.clearFirestore()
  await completeOnboarding(a.auth, a.db, { ownerName: 'A owner', businessName: 'A business' })
  await completeOnboarding(b.auth, b.db, { ownerName: 'B owner', businessName: 'B business' })
  aClient = await saveRecord(a.auth, a.db, 'clients', values('clients', { name: 'A private client' }))
  bClient = await saveRecord(b.auth, b.db, 'clients', values('clients', { name: 'B private client' }))
  aProject = await saveRecord(a.auth, a.db, 'projects', values('projects', { clientId: aClient, name: 'A project', budgetMinor: '150.00' }))
})
after(async () => { for (const app of apps) { await terminate(app.db); await deleteApp(app.app) }; await env?.cleanup() })

test('module service: clients create/edit/archive with immutable ownership and stale-write rejection', async () => {
  const initial = (await getDoc(ref(a, 'clients', aClient))).data()
  await saveRecord(a.auth, a.db, 'clients', values('clients', { name: 'Updated A client' }), aClient, 1)
  await assert.rejects(saveRecord(a.auth, a.db, 'clients', values('clients', { name: 'Stale overwrite' }), aClient, 1), /changed in another window/)
  await archiveRecord(a.auth, a.db, 'clients', aClient, 2)
  const after = (await getDoc(ref(a, 'clients', aClient))).data()
  assert.equal(after.status, 'archived'); assert.equal(after.ownerId, a.auth.currentUser.uid); assert.ok(initial.createdAt.isEqual(after.createdAt))
})
test('module service: owner-supplied extra IDs/admin fields are rejected and foreign data inaccessible', async () => {
  for (const field of ['ownerId', 'workspaceId', 'role', 'admin']) await assert.rejects(saveRecord(a.auth, a.db, 'clients', values('clients', { name: 'Bad', [field]: 'injected' })), /Unexpected fields/)
  await assertFails(getDoc(doc(b.db, 'workspaces', a.auth.currentUser.uid, 'clients', aClient)))
  assert.equal((await getDocs(collection(b.db, 'workspaces', b.auth.currentUser.uid, 'clients'))).size, 1)
})
test('module service: projects update budget/progress and cannot switch to foreign or different clients', async () => {
  const base = values('projects', { clientId: aClient, name: 'Edited project', budgetMinor: '200.25', progressPercent: '50', status: 'active' })
  await saveRecord(a.auth, a.db, 'projects', base, aProject, 1)
  const current = (await getDoc(ref(a, 'projects', aProject))).data()
  assert.equal(current.budgetMinor, 20025); assert.equal(current.progressPercent, 50)
  await assert.rejects(saveRecord(a.auth, a.db, 'projects', { ...base, clientId: bClient }, aProject, 2))
  const secondClient = await saveRecord(a.auth, a.db, 'clients', values('clients', { name: 'Second A client' }))
  await assert.rejects(saveRecord(a.auth, a.db, 'projects', { ...base, clientId: secondClient }, aProject, 2))
})
test('module service: tasks preserve project/client consistency and support completion', async () => {
  const input = values('tasks', { title: 'Task A', clientId: aClient, projectId: aProject, dueAt: '2027-01-15', priority: 'high' })
  const id = await saveRecord(a.auth, a.db, 'tasks', input)
  await saveRecord(a.auth, a.db, 'tasks', { ...input, status: 'completed' }, id, 1)
  assert.equal((await getDoc(ref(a, 'tasks', id))).data().status, 'completed')
  await assert.rejects(saveRecord(a.auth, a.db, 'tasks', { ...input, clientId: bClient }))
})
for (const kind of ['quotations', 'invoices']) {
  test(`module service: ${kind} draft head and item CRUD calculate correctly and archive locks changes`, async () => {
    const id = await saveRecord(a.auth, a.db, kind, values(kind, { clientId: aClient, projectId: aProject, title: 'Draft estimate', issueAt: '2026-01-01', dueAt: '2026-02-01' }))
    const lineId = await saveDraftItem(a.auth, a.db, kind, id, { description: 'Consulting', quantity: '2.5', price: '100.01', tax: '18', discount: '10' })
    const lineRef = doc(ref(a, kind, id), 'items', lineId), line = (await getDoc(lineRef)).data()
    assert.deepEqual(calculateLine(line), { subtotal: 25003, discount: 2500, tax: 4051, total: 26554 })
    await saveDraftItem(a.auth, a.db, kind, id, { description: 'Revised service', quantity: '1', price: '50', tax: '0', discount: '0' }, lineId, 1)
    assert.equal((await getDoc(lineRef)).data().unitPriceMinor, 5000)
    await saveDraftItem(a.auth, a.db, kind, id, { description: '', quantity: '1', price: '0', tax: '0', discount: '0' }, lineId, 2, true)
    assert.equal((await getDoc(lineRef)).exists(), false)
    const head = (await getDoc(ref(a, kind, id))).data()
    assert.equal(head.revision, 4)
    await archiveRecord(a.auth, a.db, kind, id, head.revision)
    await assert.rejects(saveDraftItem(a.auth, a.db, kind, id, { description: 'Blocked', quantity: '1', price: '1', tax: '0', discount: '0' }), /editable drafts/)
    await assert.rejects(saveRecord(a.auth, a.db, kind, values(kind, { clientId: aClient, title: 'Invalid', grandTotalMinor: '500' })), /Unexpected fields/)
  })
}
test('module service: manual partial payments retry safely and never modify history or settle invoices', async () => {
  const input = values('payments', { clientId: aClient, projectId: aProject, amountMinor: '50.00', paidAt: '2025-01-01T12:00', method: 'cash', transactionReference: 'TEST-ENTRY' })
  await Promise.all([saveRecord(a.auth, a.db, 'payments', input, 'same-submission'), saveRecord(a.auth, a.db, 'payments', input, 'same-submission')])
  await saveRecord(a.auth, a.db, 'payments', { ...input, amountMinor: '100.00' }, 'second-submission')
  const rows = await getDocs(collection(a.db, 'workspaces', a.auth.currentUser.uid, 'payments'))
  assert.equal(rows.size, 2); assert.equal(rows.docs.reduce((sum, row) => sum + row.data().amountMinor, 0), 15000)
  await assert.rejects(saveRecord(a.auth, a.db, 'payments', { ...input, amountMinor: '1.00' }, 'same-submission'), /cannot be overwritten/)
  await assert.rejects(saveRecord(a.auth, a.db, 'payments', { ...input, verified: 'true' }), /Unexpected fields/)
  assert.equal((await getDoc(ref(a, 'payments', 'same-submission'))).data().source, 'owner-recorded')
})
test('module service: business settings update own workspace name without affecting B', async () => {
  const input = { ...inputValues(settingsFields.business), name: 'A updated identity', email: 'business@example.test' }
  await saveSettings(a.auth, a.db, 'business', input)
  assert.equal((await readOwnerWorkspace(a.auth, a.db)).workspace.name, 'A updated identity')
  assert.equal((await readOwnerWorkspace(b.auth, b.db)).workspace.name, 'B business')
})
test('module service: private bank settings and invoice defaults follow exact schemas and revisions', async () => {
  const bank = { ...inputValues(settingsFields.payment), accountNumber: '000123456', bankName: 'Local test bank' }
  await saveSettings(a.auth, a.db, 'payment', bank)
  const bankRef = doc(a.db, 'workspaces', a.auth.currentUser.uid, 'settings', 'payment')
  assert.equal((await getDoc(bankRef)).data().accountNumber, '000123456')
  await assertFails(getDoc(doc(b.db, 'workspaces', a.auth.currentUser.uid, 'settings', 'payment')))
  await assert.rejects(saveSettings(a.auth, a.db, 'payment', { ...bank, instructions: 'Stale' }))
  await saveSettings(a.auth, a.db, 'payment', { ...bank, instructions: 'Updated' }, 1)
  const defaults = { ...inputValues(settingsFields.invoice), invoicePrefix: 'GM', defaultTaxBps: '18.00', paymentTermsDays: '14' }
  await saveSettings(a.auth, a.db, 'invoice', defaults)
  assert.equal((await getDoc(doc(a.db, 'workspaces', a.auth.currentUser.uid, 'settings', 'invoice'))).data().defaultTaxBps, 1800)
})
test('module service: owner account updates preserve UID/currency and validate timezone', async () => {
  await saveAccount(a.auth, a.db, { fullName: 'A owner updated', phone: '123', whatsapp: '', timezone: 'UTC', currency: 'USD', ownerId: b.auth.currentUser.uid })
  const records = await readOwnerWorkspace(a.auth, a.db)
  assert.equal(records.profile.fullName, 'A owner updated'); assert.equal(records.workspace.currency, 'INR'); assert.equal(records.workspace.id, a.auth.currentUser.uid)
  await assert.rejects(saveAccount(a.auth, a.db, { fullName: 'A', phone: '', whatsapp: '', timezone: 'Not/AZone' }), /valid timezone/)
})
test('module service: invalid dates, amounts and unknown fields fail without writing', async () => {
  for (const value of ['1e3', '-1', '1.234', 'NaN']) assert.throws(() => scaledInteger(value))
  await assert.rejects(saveRecord(a.auth, a.db, 'projects', values('projects', { clientId: aClient, name: 'Bad', startAt: '2026-02-31' })), /valid start date/)
  await assert.rejects(saveRecord(a.auth, a.db, 'payments', values('payments', { clientId: aClient, amountMinor: '0', paidAt: '2025-01-01T00:00' })))
  assert.deepEqual(calculateDocument([]), { subtotal: 0, discount: 0, tax: 0, total: 0 })
  assert.equal(calculateDocument([{ quantityMilli: 1000, unitPriceMinor: 101, taxRateBps: 0, discountBps: 0 }, { quantityMilli: 1000, unitPriceMinor: 202, taxRateBps: 0, discountBps: 0 }]).total, 303)
})
