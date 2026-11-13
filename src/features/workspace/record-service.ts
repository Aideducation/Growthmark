import type { Auth } from 'firebase/auth'
import { collection, doc, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore'
import type { Firestore, DocumentData } from 'firebase/firestore'
import { requireLocalAuth } from '../auth/auth-api.ts'
import { requireMatchingFirebase } from '../../services/firebase-mode.ts'
import { entityFields, settingsFields } from './schema.ts'
import type { Entity, Field, InputValues, SettingsKind } from './schema.ts'
import { scaledInteger, calculateLine } from './money.ts'

export async function recordOwner(auth: Auth, db: Firestore) {
  requireLocalAuth(auth)
  requireMatchingFirebase(auth, db)
  const user = auth.currentUser
  if (!user || !user.emailVerified || !user.email || db.app.options.projectId !== auth.app.options.projectId) throw new Error('Sign in with a verified workspace owner account.')
  const token = await user.getIdTokenResult()
  if (token.claims.email_verified !== true || auth.currentUser?.uid !== user.uid) throw new Error('Your session changed. Sign in again.')
  return user
}
export function normalize(fields: Field[], input: InputValues): DocumentData {
  if (Object.keys(input).some(key => !fields.some(field => field.key === key))) throw new Error('Unexpected fields were submitted.')
  return Object.fromEntries(fields.map(field => {
    const value = (input[field.key] ?? '').trim()
    if (field.required && !value) throw new Error(`${field.label} is required.`)
    if (field.type === 'date' || field.type === 'datetime-local') {
      if (!value) return [field.key, null]
      const date = new Date(field.type === 'date' ? `${value}T00:00:00Z` : value)
      if (Number.isNaN(date.getTime()) || (field.type === 'date' && date.toISOString().slice(0, 10) !== value)) throw new Error(`Enter a valid ${field.label.toLowerCase()}.`)
      return [field.key, Timestamp.fromDate(date)]
    }
    if (field.type === 'money' || field.type === 'number') {
      const number = field.type === 'money' ? scaledInteger(value || '0') : Number(value || '0')
      const display = field.type === 'money' ? number / 100 : number
      if (!Number.isSafeInteger(number) || display < (field.min ?? 0) || (field.max != null && display > field.max)) throw new Error(`${field.label} is outside the allowed range.`)
      return [field.key, number]
    }
    if (field.type === 'client' || field.type === 'project') return [field.key, value || null]
    if (field.type === 'select' && !field.options?.includes(value)) throw new Error(`Choose a valid ${field.label.toLowerCase()}.`)
    if (value.length > (field.max ?? 5000)) throw new Error(`${field.label} is too long.`)
    return [field.key, value]
  }))
}
function envelope(uid: string) { return { schemaVersion: 1, workspaceId: uid, ownerId: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), revision: 1 } }
function checkRevision(data: DocumentData, expected?: number) { if (data.revision !== expected) throw new Error('This record changed in another window. Close the form and reopen it before saving.') }
function validId(id: string) { if (!id || id.includes('/') || id.length > 150) throw new Error('Invalid record identifier.') }
export async function saveRecord(auth: Auth, db: Firestore, kind: Entity, input: InputValues, id?: string, expectedRevision?: number) {
  if (!(kind in entityFields)) throw new Error('This module cannot be saved.')
  const user = await recordOwner(auth, db), payload = normalize(entityFields[kind], input)
  if (kind === 'invoices' && !id) throw new Error('Create invoices through the numbered invoice service.')
  if (id) validId(id)
  const ref = id ? doc(db, 'workspaces', user.uid, kind, id) : doc(collection(db, 'workspaces', user.uid, kind))
  await runTransaction(db, async transaction => {
    const workspace = await transaction.get(doc(db, 'workspaces', user.uid))
    const existing = await transaction.get(ref)
    if (kind === 'invoices' && !existing.exists()) throw new Error('Create invoices through the numbered invoice service.')
    if (auth.currentUser?.uid !== user.uid || workspace.data()?.ownerId !== user.uid) throw new Error('Workspace ownership could not be verified.')
    if (kind === 'payments') {
      payload.currency = workspace.data()?.currency
      payload.source = 'owner-recorded'
      if ((payload.amountMinor as number) <= 0 || (payload.paidAt as Timestamp).toMillis() > Date.now()) throw new Error('Enter a positive amount and a payment date that is not in the future.')
      if (existing.exists()) {
        const equal = Object.entries(payload).every(([key, value]) => value instanceof Timestamp ? value.isEqual(existing.data()[key]) : value === existing.data()[key])
        if (!equal) throw new Error('This payment submission already exists. Payment history cannot be overwritten.')
        return
      }
    } else if (existing.exists()) checkRevision(existing.data(), expectedRevision)
    else if (expectedRevision != null) throw new Error('This record no longer exists.')
    if (kind === 'quotations' || kind === 'invoices') {
      if (existing.exists() && existing.data().state !== 'draft') throw new Error('Archived documents are read-only.')
      payload.state = existing.data()?.state ?? 'draft'
    }
    if (existing.exists()) transaction.update(ref, { ...payload, updatedAt: serverTimestamp(), revision: existing.data().revision + 1 })
    else transaction.set(ref, { ...envelope(user.uid), ...payload })
  })
  return ref.id
}
export async function archiveRecord(auth: Auth, db: Firestore, kind: 'clients' | 'projects' | 'quotations' | 'invoices', id: string, revision: number) {
  const user = await recordOwner(auth, db); validId(id)
  await runTransaction(db, async transaction => {
    const ref = doc(db, 'workspaces', user.uid, kind, id), snapshot = await transaction.get(ref)
    if (!snapshot.exists()) throw new Error('Record not found.')
    checkRevision(snapshot.data(), revision)
    transaction.update(ref, { [kind === 'clients' || kind === 'projects' ? 'status' : 'state']: 'archived', updatedAt: serverTimestamp(), revision: revision + 1 })
  })
}
export async function saveSettings(auth: Auth, db: Firestore, kind: SettingsKind, input: InputValues, expectedRevision?: number) {
  if (!(kind in settingsFields)) throw new Error('Unknown settings section.')
  const user = await recordOwner(auth, db), payload = normalize(settingsFields[kind], input)
  await runTransaction(db, async transaction => {
    const workspaceRef = doc(db, 'workspaces', user.uid), ref = doc(workspaceRef, 'settings', kind)
    const workspace = await transaction.get(workspaceRef), existing = await transaction.get(ref)
    if (auth.currentUser?.uid !== user.uid || workspace.data()?.ownerId !== user.uid) throw new Error('Workspace ownership could not be verified.')
    if (existing.exists()) checkRevision(existing.data(), expectedRevision)
    else if (expectedRevision != null) throw new Error('Settings changed. Reopen the form.')
    if (existing.exists()) transaction.update(ref, { ...payload, updatedAt: serverTimestamp(), revision: existing.data().revision + 1 })
    else transaction.set(ref, { ...envelope(user.uid), ...payload })
    if (kind === 'business') transaction.update(workspaceRef, { name: payload.name, updatedAt: serverTimestamp() })
  })
}
export async function saveAccount(auth: Auth, db: Firestore, input: { fullName: string; phone: string; whatsapp: string; timezone: string }) {
  const user = await recordOwner(auth, db)
  if (!input.fullName.trim() || input.fullName.length > 160 || input.phone.length > 40 || input.whatsapp.length > 40) throw new Error('Check the owner name and contact details.')
  try { new Intl.DateTimeFormat('en', { timeZone: input.timezone }).format() } catch { throw new Error('Choose a valid timezone.') }
  await runTransaction(db, async transaction => {
    const ref = doc(db, 'users', user.uid), workspace = doc(db, 'workspaces', user.uid)
    const profile = await transaction.get(ref), owner = await transaction.get(workspace)
    if (auth.currentUser?.uid !== user.uid || owner.data()?.ownerId !== user.uid || profile.data()?.userId !== user.uid) throw new Error('Workspace ownership could not be verified.')
    transaction.update(ref, { fullName: input.fullName.trim(), phone: input.phone.trim(), whatsapp: input.whatsapp.trim(), email: user.email, updatedAt: serverTimestamp() })
    transaction.update(workspace, { timezone: input.timezone, updatedAt: serverTimestamp() })
  })
}
export async function saveDraftItem(auth: Auth, db: Firestore, kind: 'quotations' | 'invoices', draftId: string, values: { description: string; quantity: string; price: string; tax: string; discount: string }, itemId?: string, expectedRevision?: number, remove = false) {
  const user = await recordOwner(auth, db); validId(draftId); if (itemId) validId(itemId)
  const parent = doc(db, 'workspaces', user.uid, kind, draftId), ref = itemId ? doc(parent, 'items', itemId) : doc(collection(parent, 'items'))
  const payload = { description: values.description.trim(), quantityMilli: scaledInteger(values.quantity, 3), unitPriceMinor: scaledInteger(values.price), taxRateBps: scaledInteger(values.tax || '0'), discountBps: scaledInteger(values.discount || '0') }
  if (!remove) { if (!payload.description || payload.description.length > 2000) throw new Error('Enter a service description of up to 2,000 characters.'); calculateLine(payload) }
  await runTransaction(db, async transaction => {
    const head = await transaction.get(parent), existing = await transaction.get(ref)
    if (auth.currentUser?.uid !== user.uid || head.data()?.ownerId !== user.uid || head.data()?.state !== 'draft') throw new Error('Only your editable drafts can be changed.')
    if (existing.exists()) checkRevision(existing.data(), expectedRevision)
    else if (expectedRevision != null || remove) throw new Error('This line item changed. Reopen the document.')
    transaction.update(parent, { updatedAt: serverTimestamp(), revision: head.data()!.revision + 1 })
    if (remove) transaction.delete(ref)
    else if (existing.exists()) transaction.update(ref, { ...payload, updatedAt: serverTimestamp(), revision: existing.data().revision + 1 })
    else transaction.set(ref, { ...envelope(user.uid), ...payload })
  })
  return ref.id
}
