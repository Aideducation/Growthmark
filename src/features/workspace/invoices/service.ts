import type { Auth } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'
import { collection, doc, getDoc, getDocFromServer, getDocs, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore'
import { recordOwner } from '../record-service.ts'
import { calculateInvoice, validateAgency, validateDraft } from './model.ts'
import type { Agency, InvoiceDraft } from './model.ts'
import { decodeInvoiceSnapshot, encodeInvoiceContent, validateSnapshotByteSize } from './snapshot-codec.ts'
import type { InvoiceAllocationMetadata } from './snapshot-codec.ts'
import { allocateInvoice } from './allocation.ts'
import { createInvoiceAllocationStore } from './allocation-store.ts'
import type { InvoiceAllocationInput, InvoiceAllocationResult, InvoicePaymentDetails, ManualInvoiceStatus } from './allocation-types.ts'
import { agencyWithPaymentDetails, invoiceReference, validateInvoicePrefix, validateManualStatus, validatePaymentDetails } from './workflow.ts'
import type { RecordRow } from '../schema.ts'
import type { PendingInvoiceRequest } from './pending-request.ts'
import { allocationIdentity, MAX_PROTECTED_INVOICE_ITEMS } from './allocation-identity.ts'

function metadata(uid: string) { return { schemaVersion: 1, workspaceId: uid, ownerId: uid, revision: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp() } }
function revision(existing: { revision?: unknown }, expected?: number) { if (existing.revision !== expected) throw new Error('This record changed in another window. Close and reopen it before saving.') }
export async function loadAgency(auth: Auth, db: Firestore): Promise<{ agency: Agency; revision: number; invoicePrefix?: string } | null> {
  const user = await recordOwner(auth, db), result = await getDoc(doc(db, 'workspaces', user.uid, 'settings', 'agency'))
  if (!result.exists()) return null
  if (result.data().ownerId !== user.uid) throw new Error('Invalid agency ownership.')
  const prefix = (await getDoc(doc(db, 'workspaces', user.uid, 'settings', 'invoice'))).data()?.invoicePrefix
  return { agency: validateAgency(JSON.parse(result.data().profileJson)), revision: result.data().revision, invoicePrefix: typeof prefix === 'string' && prefix ? prefix : undefined }
}
/** Read legacy defaults from the authenticated workspace, never stale cross-account UI state. */
export async function loadAgencyDefaults(auth: Auth, db: Firestore): Promise<Record<'business' | 'payment' | 'invoice', RecordRow | null>> {
  const user = await recordOwner(auth, db)
  const rows = await Promise.all((['business', 'payment', 'invoice'] as const).map(async id => {
    const snapshot = await getDocFromServer(doc(db, 'workspaces', user.uid, 'settings', id))
    if (!snapshot.exists()) return [id, null] as const
    if (snapshot.data().ownerId !== user.uid || snapshot.data().workspaceId !== user.uid) throw new Error('Invalid settings ownership.')
    return [id, { ...snapshot.data(), id } as RecordRow] as const
  }))
  if (auth.currentUser?.uid !== user.uid) throw new Error('Your account changed. Reopen Agency Settings.')
  return Object.fromEntries(rows) as Record<'business' | 'payment' | 'invoice', RecordRow | null>
}
export async function saveAgency(auth: Auth, db: Firestore, agency: Agency, expected?: number, invoicePrefix?: string) {
  const user = await recordOwner(auth, db), profileJson = JSON.stringify(validateAgency(agency))
  if (invoicePrefix !== undefined) validateInvoicePrefix(invoicePrefix)
  const ref = doc(db, 'workspaces', user.uid, 'settings', 'agency')
  const preferences = doc(db, 'workspaces', user.uid, 'settings', 'invoice')
  await runTransaction(db, async tx => {
    const workspace = await tx.get(doc(db, 'workspaces', user.uid)), current = await tx.get(ref)
    const existingPreferences = invoicePrefix === undefined ? null : await tx.get(preferences)
    if (workspace.data()?.ownerId !== user.uid || auth.currentUser?.uid !== user.uid) throw new Error('Workspace ownership changed.')
    revision(current.data() ?? {}, expected)
    if (current.exists()) tx.update(ref, { profileJson, revision: expected! + 1, updatedAt: serverTimestamp() })
    else tx.set(ref, { ...metadata(user.uid), profileJson })
    if (invoicePrefix !== undefined) {
      if (existingPreferences?.exists()) tx.update(preferences, { invoicePrefix, revision: existingPreferences.data().revision + 1, updatedAt: serverTimestamp() })
      else tx.set(preferences, { ...metadata(user.uid), invoicePrefix, quotationPrefix: 'QUO', paymentTermsDays: 14, footer: '', thankYouMessage: '', defaultTaxBps: 0, defaultDiscountBps: 0 })
    }
  })
}
export interface LoadedInvoiceSnapshot {
  draft: InvoiceDraft; revision: number; allocation?: InvoiceAllocationMetadata; header: RecordRow
  reference: string; manualStatus: ManualInvoiceStatus; paymentOverride?: InvoicePaymentDetails; paymentRevision?: number
}
export async function loadInvoiceSnapshot(auth: Auth, db: Firestore, id: string, _includePaymentOverride = true): Promise<LoadedInvoiceSnapshot | null> {
  const user = await recordOwner(auth, db)
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(id)) throw new Error('Invalid invoice identifier.')
  const result = await getDoc(doc(db, 'workspaces', user.uid, 'invoices', id, 'configuration', 'snapshot'))
  if (!result.exists()) return null
  if (result.data().ownerId !== user.uid || result.data().workspaceId !== user.uid) throw new Error('Invalid invoice ownership.')
  const header = await getDocFromServer(doc(db, 'workspaces', user.uid, 'invoices', id))
  if (!header.exists() || header.data().ownerId !== user.uid || header.data().workspaceId !== user.uid) throw new Error('Invoice ownership could not be verified.')
  // Compatibility argument retained; creation flags must never hide saved payment instructions.
  void _includePaymentOverride
  const override = await getDocFromServer(doc(db, 'workspaces', user.uid, 'invoices', id, 'configuration', 'paymentOverride'))
  if (override?.exists() && (override.data().ownerId !== user.uid || override.data().workspaceId !== user.uid)) throw new Error('Invalid invoice payment ownership.')
  const paymentOverride = override?.exists() ? validatePaymentDetails(override.data().details) : undefined
  const data = result.data()
  if (auth.currentUser?.uid !== user.uid) throw new Error('Your account changed. Reopen the invoice.')
  return { revision: data.revision, ...decodeInvoiceSnapshot(data, id, paymentOverride, allocationIdentity(header.data(), user.uid, id)), header: { ...header.data(), id } as RecordRow,
    reference: invoiceReference(header.data()), manualStatus: validateManualStatus(header.data().manualStatus ?? 'draft'), paymentOverride, paymentRevision: override?.data()?.revision }
}
export async function recoverInvoiceRequest(auth: Auth, db: Firestore, request: PendingInvoiceRequest): Promise<LoadedInvoiceSnapshot | null> {
  const user = await recordOwner(auth, db)
  if (request.ownerId !== user.uid || !/^[A-Za-z0-9_-]{1,128}$/.test(request.invoiceId)) throw new Error('The pending save belongs to another account.')
  const head = await getDocFromServer(doc(db, 'workspaces', user.uid, 'invoices', request.invoiceId))
  if (!head.exists()) return null
  const invoice = await loadInvoiceSnapshot(auth, db, request.invoiceId, true)
  const protectedIdentity = invoice && allocationIdentity(invoice.header, user.uid, request.invoiceId)
  if (!protectedIdentity || protectedIdentity.requestId !== request.requestId) throw new Error('The saved invoice does not match this protected allocation request. No new invoice was created.')
  return invoice
}
export interface InvoiceSavePreferences {
  manualStatus?: ManualInvoiceStatus
  paymentOverride?: InvoicePaymentDetails
  usePaymentOverride?: boolean
  expectedPaymentRevision?: number
}
function preferences(value: InvoiceSavePreferences): InvoiceSavePreferences {
  if (Object.keys(value).some(key => !['manualStatus', 'paymentOverride', 'usePaymentOverride', 'expectedPaymentRevision'].includes(key))) throw new Error('Unexpected invoice preferences.')
  if (value.manualStatus !== undefined) validateManualStatus(value.manualStatus)
  return { ...value, ...(value.paymentOverride === undefined ? {} : { paymentOverride: validatePaymentDetails(value.paymentOverride) }) }
}
export interface NewInvoiceRequest {
  readonly invoiceId: string
  readonly requestId: string
  readonly projectId?: string | null
}

/** Explicit creation entry point. Caller retains both IDs until the result is confirmed. */
export async function createNumberedInvoice(auth: Auth, db: Firestore, draft: InvoiceDraft, clientId: string, request: NewInvoiceRequest, options: InvoiceSavePreferences = {}): Promise<InvoiceAllocationResult> {
  const choice = preferences(options)
  const user = await recordOwner(auth, db), valid = validateDraft(draft, choice.paymentOverride ? agencyWithPaymentDetails(draft.agency, choice.paymentOverride) : undefined), totals = calculateInvoice(valid)
  if (!request || typeof request !== 'object' || Object.keys(request).some(key => !['invoiceId', 'requestId', 'projectId'].includes(key))) throw new Error('Provide a stable invoice ID and allocation request ID.')
  const validId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)
  if (!validId(clientId) || !validId(request.invoiceId) || !validId(request.requestId) || (request.projectId != null && !validId(request.projectId))) throw new Error('Invalid client, project, invoice or allocation request identifier.')
  // Capture caller-owned IDs before asynchronous reads; never generate replacements on retry.
  const invoiceId = request.invoiceId, requestId = request.requestId, projectId = request.projectId ?? null
  const workspacePath = `workspaces/${user.uid}`
  const workspace = await getDocFromServer(doc(db, workspacePath))
  if (workspace.data()?.ownerId !== user.uid || auth.currentUser?.uid !== user.uid) throw new Error('Workspace ownership could not be verified.')
  if (valid.currency !== workspace.data()?.currency) throw new Error('Use your workspace currency. Mixed-currency reporting is not supported yet.')
  const { agency, client } = valid
  const items: InvoiceAllocationInput['items'] = valid.lines.map((line, index) => ({
    id: `advanced-${line.id}`, description: `${line.name}${line.description ? ' — ' + line.description : ''}`.slice(0, 2000),
    quantityMilli: 1000, unitPriceMinor: totals.lines[index].total, taxRateBps: 0, discountBps: 0,
  }))
  if (totals.charges) items.push({ id: 'advanced-charges', description: 'Additional non-taxable charges', quantityMilli: 1000, unitPriceMinor: totals.charges, taxRateBps: 0, discountBps: 0 })
  if (items.length > MAX_PROTECTED_INVOICE_ITEMS) throw new Error('New numbered invoices support at most eight item records, including an additional charges item. No number was allocated.')
  const payload: InvoiceAllocationInput = {
    header: { clientId, projectId, title: valid.title, state: 'draft', manualStatus: choice.manualStatus ?? 'draft', issueAt: Timestamp.fromDate(new Date(valid.date + 'T00:00:00Z')), dueAt: valid.due ? Timestamp.fromDate(new Date(valid.due + 'T00:00:00Z')) : null, terms: valid.terms, notes: valid.notes },
    snapshot: { agencyJson: JSON.stringify(agency), clientJson: JSON.stringify(client), contentJson: encodeInvoiceContent(valid) }, items,
    ...(choice.paymentOverride ? { override: choice.paymentOverride } : {}),
  }
  const base = await createInvoiceAllocationStore(auth, db)
  if (base.ownerId !== user.uid) throw new Error('Your session changed. Reopen the invoice before saving.')
  // Currency is rechecked inside every transaction and each recovery read, not just the form.
  const checkWorkspace = (path: string, value: Awaited<ReturnType<typeof base.read>>) => {
    if (path === workspacePath && value.data()?.currency !== valid.currency) throw new Error('Use your workspace currency. Mixed-currency reporting is not supported yet.')
    return value
  }
  return allocateInvoice({
    ...base,
    read: async path => checkWorkspace(path, await base.read(path)),
    transact: operation => base.transact(tx => operation({ ...tx, get: async path => checkWorkspace(path, await tx.get(path)) })),
  }, invoiceId, requestId, payload)
}

/** Existing invoices only. Creation is exclusively handled by createNumberedInvoice. */
export async function saveAdvancedDraft(auth: Auth, db: Firestore, draft: InvoiceDraft, clientId: string, id?: string, expectedHead?: number, expectedSnapshot?: number, options: InvoiceSavePreferences = {}) {
  const user = await recordOwner(auth, db), choice = preferences(options)
  if (!id || expectedHead === undefined) throw new Error('New invoice creation requires the numbered creation service and a stable allocation request ID. The creation screen is not connected yet.')
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(clientId) || id && !/^[A-Za-z0-9_-]{1,150}$/.test(id)) throw new Error('Invalid client or invoice identifier.')
  const head = doc(db, 'workspaces', user.uid, 'invoices', id)
  const snap = doc(head, 'configuration', 'snapshot')
  const paymentRef = doc(head, 'configuration', 'paymentOverride')
  const readPayment = true // Never silently ignore a saved override when creation is disabled.
  const paymentBefore = readPayment ? await getDocFromServer(paymentRef) : null
  if (paymentBefore?.exists() && (paymentBefore.data().ownerId !== user.uid || paymentBefore.data().workspaceId !== user.uid)) throw new Error('Invalid invoice payment ownership.')
  const savedPayment = paymentBefore?.exists() ? validatePaymentDetails(paymentBefore.data().details) : undefined
  const selectedPayment = choice.paymentOverride ?? savedPayment
  const valid = validateDraft(draft, selectedPayment ? agencyWithPaymentDetails(draft.agency, selectedPayment) : undefined), totals = calculateInvoice(valid)
  if (valid.currency !== (await getDoc(doc(db, 'workspaces', user.uid))).data()?.currency) throw new Error('Use your workspace currency. Mixed-currency reporting is not supported yet.')
  const oldItems = await getDocs(collection(head, 'items'))
  if (oldItems.size > 100) throw new Error('This invoice exceeds the supported edit size. No data was changed.')
  const { agency, client } = valid
  const agencyJson = JSON.stringify(agency), clientJson = JSON.stringify(client)
  await runTransaction(db, async tx => {
    const current = await tx.get(head), snapshot = await tx.get(snap), workspace = await tx.get(doc(db, 'workspaces', user.uid)), customer = await tx.get(doc(db, 'workspaces', user.uid, 'clients', clientId))
    const payment = readPayment ? await tx.get(paymentRef) : null
    if (readPayment && payment?.data()?.revision !== paymentBefore?.data()?.revision) throw new Error('Invoice payment details changed in another window. Reopen the invoice.')
    if (choice.paymentOverride !== undefined) {
      if (payment?.data()?.revision !== choice.expectedPaymentRevision) throw new Error('Invoice payment details changed in another window. Reopen the invoice.')
      if (!snapshot.exists()) throw new Error('Save the original invoice snapshot before adding an invoice-specific payment override.')
    }
    if (workspace.data()?.ownerId !== user.uid || !customer.exists() || customer.data().ownerId !== user.uid || auth.currentUser?.uid !== user.uid) throw new Error('Client or workspace ownership could not be verified.')
    if (!current.exists()) throw new Error('This invoice does not exist. Editing cannot create or allocate an invoice.')
    revision(current.data() ?? {}, expectedHead); revision(snapshot.data() ?? {}, expectedSnapshot)
    if (current.exists() && (current.data().state !== 'draft' || current.data().clientId !== clientId)) throw new Error('Only editable drafts for the same client can be saved.')
    if (snapshot.exists() && (snapshot.data().agencyJson !== agencyJson || snapshot.data().clientJson !== clientJson)) throw new Error('Saved agency and client snapshots are frozen. Create a new draft to use different details.')
    // Never accept allocation metadata from form input or generate it for a legacy edit.
    // Reading inside the transaction also protects against stale/concurrent snapshot edits.
    const protectedIdentity = allocationIdentity(current.data(), user.uid, head.id)
    const allocation = snapshot.exists() ? decodeInvoiceSnapshot(snapshot.data(), head.id, savedPayment, protectedIdentity).allocation : undefined
    const contentJson = encodeInvoiceContent(valid, allocation)
    validateSnapshotByteSize({ agencyJson, clientJson, contentJson })
    // Read every existing item before writing, so the transaction detects concurrent edits.
    for (const item of oldItems.docs) await tx.get(item.ref)
    const itemIds = valid.lines.map(line => `advanced-${line.id}`)
    if (totals.charges) itemIds.push('advanced-charges')
    if (protectedIdentity && itemIds.length > MAX_PROTECTED_INVOICE_ITEMS) throw new Error('Protected invoices support at most eight item records, including charges.')
    const payload = { title: valid.title, clientId, projectId: current.data()?.projectId ?? null, state: 'draft', issueAt: Timestamp.fromDate(new Date(valid.date + 'T00:00:00Z')), dueAt: valid.due ? Timestamp.fromDate(new Date(valid.due + 'T00:00:00Z')) : null, terms: valid.terms, notes: valid.notes, ...(choice.manualStatus === undefined ? {} : { manualStatus: choice.manualStatus }), ...(protectedIdentity ? { itemIds } : {}) }
    tx.update(head, { ...payload, revision: expectedHead + 1, updatedAt: serverTimestamp() })
    if (snapshot.exists()) tx.update(snap, { contentJson, revision: expectedSnapshot! + 1, updatedAt: serverTimestamp() })
    else tx.set(snap, { ...metadata(user.uid), agencyJson, clientJson, contentJson })
    if (choice.paymentOverride !== undefined) {
      if (payment?.exists()) tx.update(paymentRef, { details: choice.paymentOverride, revision: payment.data().revision + 1, updatedAt: serverTimestamp() })
      else tx.set(paymentRef, { ...metadata(user.uid), details: choice.paymentOverride })
    }
    const retained = new Set(valid.lines.map(line => `advanced-${line.id}`))
    const invoiceRevision = expectedHead + 1
    if (totals.charges) retained.add('advanced-charges')
    for (const item of oldItems.docs) if (!retained.has(item.id)) tx.delete(item.ref)
    function summary(id: string, description: string, amount: number) {
      const previous = oldItems.docs.find(item => item.id === id)
      const payload = { description, quantityMilli: 1000, unitPriceMinor: amount, taxRateBps: 0, discountBps: 0, ...(protectedIdentity ? { allocationIndex: itemIds.indexOf(id), invoiceRevision } : {}) }
      if (previous) tx.update(previous.ref, { ...payload, revision: previous.data().revision + 1, updatedAt: serverTimestamp() })
      else tx.set(doc(head, 'items', id), { ...metadata(user.uid), ...payload })
    }
    // Legacy dashboard/report readers still sum the same exact draft total. Detailed rate/tax data
    // belongs to the snapshot; these existing-schema items contain final estimate contributions.
    valid.lines.forEach((line, index) => summary(`advanced-${line.id}`, `${line.name}${line.description ? ' — ' + line.description : ''}`.slice(0, 2000), totals.lines[index].total))
    if (totals.charges) summary('advanced-charges', 'Additional non-taxable charges', totals.charges)
  })
  return head.id
}
