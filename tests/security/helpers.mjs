import { readFile } from 'node:fs/promises'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, serverTimestamp, setLogLevel, writeBatch, Timestamp } from 'firebase/firestore'

export const PROJECT = 'demo-growthmark-security-tests'
export const A = 'freelancer-a'
export const B = 'freelancer-b'
export const oldDate = Timestamp.fromDate(new Date('2025-01-01T00:00:00Z'))
setLogLevel('silent')

export function requireEmulators() {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180'
    || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9199'
    || process.env.GCLOUD_PROJECT !== PROJECT) {
    throw new Error('Refusing to run: both loopback emulators and demo project are required.')
  }
}
export async function environment() {
  requireEmulators()
  const rulesFile = process.env.GROWTHMARK_RULES_FILE === 'firestore.agency-invoice.proposed.rules'
    ? 'firestore.agency-invoice.proposed.rules' : 'firestore.rules'
  return initializeTestEnvironment({ projectId: PROJECT, firestore: {
    host: '127.0.0.1', port: 8180,
    rules: await readFile(new URL(`../../${rulesFile}`, import.meta.url), 'utf8'),
  } })
}
export function identity(env, uid, overrides = {}) {
  return env.authenticatedContext(uid, {
    email: `${uid}@example.test`, email_verified: true,
    firebase: { sign_in_provider: 'password' }, ...overrides,
  }).firestore()
}
export function meta(uid) {
  return { schemaVersion: 1, workspaceId: uid, ownerId: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), revision: 1 }
}
export function profile(uid, email = `${uid}@example.test`) {
  return { schemaVersion: 1, userId: uid, workspaceId: uid, fullName: uid, email, phone: '', whatsapp: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
}
export function workspace(uid) {
  return { schemaVersion: 1, ownerId: uid, name: 'Security test workspace', currency: 'INR', timezone: 'Asia/Kolkata', onboarding: 'business-profile', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
}
export function client(uid) {
  return { ...meta(uid), name: 'Test client', company: '', email: '', phone: '', whatsapp: '', address: '', services: '', notes: '', status: 'active' }
}
export function project(uid) {
  return { ...meta(uid), clientId: 'client', name: 'Test project', description: '', serviceCategory: 'Consulting', budgetMinor: 10000, startAt: null, deadlineAt: null, status: 'active', progressPercent: 0, notes: '' }
}
export function task(uid) {
  return { ...meta(uid), clientId: 'client', projectId: 'project', title: 'Test task', description: '', priority: 'medium', dueAt: null, status: 'todo' }
}
export function draft(uid) {
  return { ...meta(uid), clientId: 'client', projectId: 'project', title: 'Test draft', state: 'draft', issueAt: oldDate, dueAt: null, terms: '', notes: '' }
}
export function item(uid) {
  return { ...meta(uid), description: 'Consulting', quantityMilli: 1000, unitPriceMinor: 10000, taxRateBps: 0, discountBps: 0 }
}
export function payment(uid) {
  return { ...meta(uid), clientId: 'client', projectId: 'project', amountMinor: 5000, currency: 'INR', paidAt: oldDate, method: 'bank-transfer', transactionReference: 'TEST-ONLY', notes: '', source: 'owner-recorded' }
}
export const settingsFactories = {
  business: uid => ({ ...meta(uid), name: 'Test business', businessType: '', industry: '', email: '', phone: '', whatsapp: '', website: '', street: '', city: '', state: '', country: '', postalCode: '', gstin: '' }),
  payment: uid => ({ ...meta(uid), upiId: '', accountHolder: '', bankName: '', accountNumber: '', ifsc: '', instructions: '' }),
  invoice: uid => ({ ...meta(uid), invoicePrefix: 'INV', quotationPrefix: 'QUO', paymentTermsDays: 14, footer: '', thankYouMessage: '', defaultTaxBps: 0, defaultDiscountBps: 0 }),
}
export const factories = { clients: client, projects: project, tasks: task, quotations: draft, invoices: draft, payments: payment }
export async function bootstrap(db, uid, email) {
  const batch = writeBatch(db)
  batch.set(doc(db, `users/${uid}`), profile(uid, email))
  batch.set(doc(db, `workspaces/${uid}`), workspace(uid))
  await batch.commit()
}
export async function seedWorkspace(db, uid) {
  await bootstrap(db, uid)
  // Separate commits so reference validation always sees existing parents.
  const { setDoc } = await import('firebase/firestore')
  await setDoc(doc(db, `workspaces/${uid}/clients/client`), client(uid))
  await setDoc(doc(db, `workspaces/${uid}/projects/project`), project(uid))
  const batch = writeBatch(db)
  for (const kind of ['tasks', 'quotations', 'invoices', 'payments']) batch.set(doc(db, `workspaces/${uid}/${kind}/record`), factories[kind](uid))
  for (const [name, factory] of Object.entries(settingsFactories)) batch.set(doc(db, `workspaces/${uid}/settings/${name}`), factory(uid))
  await batch.commit()
  for (const kind of ['quotations', 'invoices']) await setDoc(doc(db, `workspaces/${uid}/${kind}/record/items/item`), item(uid))
}
