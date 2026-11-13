import { allocationIdentity, MAX_PROTECTED_INVOICE_ITEMS } from './allocation-identity.ts'
import { validateSnapshotByteSize } from './snapshot-codec.ts'
import type { AllocationDocument, InvoiceAllocationInput, InvoiceAllocationResult, InvoiceAllocationStore } from './allocation-types.ts'

export const MAX_ALLOCATION_ATTEMPTS = 3
export class AllocationError extends Error {
  readonly code: string
  constructor(code: string, message: string, cause?: unknown) {
    super(message, { cause }); this.name = 'AllocationError'; this.code = code
  }
}
const idPattern = /^[A-Za-z0-9_-]{1,128}$/
const prefixPattern = /^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/
const statuses = ['draft', 'sent', 'pending', 'paid', 'overdue', 'cancelled']
function fail(message: string): never { throw new AllocationError('invalid-allocation', message) }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function exact(value: Record<string, unknown>, keys: readonly string[]) { return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)) }
function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.length <= max }
function identifier(value: unknown): value is string { return typeof value === 'string' && idPattern.test(value) }
function integer(value: unknown, min: number, max: number): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max }
function millis(value: unknown): number | null {
  if (!record(value) || typeof value.toMillis !== 'function') return null
  const result: unknown = value.toMillis()
  return typeof result === 'number' && Number.isFinite(result) ? result : null
}

/** Runtime validation is required even for typed callers. No ownership comes from this input. */
function validate(value: unknown): asserts value is InvoiceAllocationInput {
  if (!record(value) || !record(value.header) || !record(value.snapshot) || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > MAX_PROTECTED_INVOICE_ITEMS) fail('New numbered invoices support 1–8 item records, including charges. Existing invoices are unchanged.')
  const h = value.header, s = value.snapshot
  const keys = ['clientId', 'projectId', 'title', 'state', 'issueAt', 'dueAt', 'terms', 'notes', 'manualStatus']
  if (Object.keys(h).some(key => !keys.includes(key)) || !identifier(h.clientId) || (h.projectId !== null && !identifier(h.projectId))) fail('Invalid invoice reference or fields.')
  if (h.state !== 'draft' || !statuses.includes(String(h.manualStatus ?? 'draft'))) fail('Invalid invoice status.')
  for (const [key, max] of [['title', 200], ['terms', 5000], ['notes', 5000]] as const) if (!text(h[key], max) || (key === 'title' && !h[key].trim())) fail('Invalid invoice text.')
  const issued = millis(h.issueAt), due = millis(h.dueAt)
  if (issued === null || (h.dueAt !== null && (due === null || due < issued))) fail('Invalid invoice dates.')
  if (!exact(s, ['agencyJson', 'clientJson', 'contentJson'])) fail('Invalid snapshot fields.')
  for (const [key, max] of [['agencyJson', 150000], ['clientJson', 10000], ['contentJson', 219000]] as const) {
    if (!text(s[key], max)) fail('Invalid snapshot size.')
    try { const parsed: unknown = JSON.parse(s[key]); if (!record(parsed) || '_allocation' in parsed) fail('Invalid snapshot content.') } catch { fail('Invalid snapshot JSON.') }
  }
  validateSnapshotByteSize(s as unknown as InvoiceAllocationInput['snapshot'])
  const ids = new Set<string>()
  for (const item of value.items) {
    if (!record(item) || !identifier(item.id) || ids.has(item.id) || !exact(item, ['id', 'description', 'quantityMilli', 'unitPriceMinor', 'taxRateBps', 'discountBps'])) fail('Invalid invoice item fields.')
    ids.add(item.id)
    if (!text(item.description, 2000) || !item.description.length) fail('Invalid invoice item description.')
    for (const [key, min, max] of [['quantityMilli', 1, 1e9], ['unitPriceMinor', 0, 1e12], ['taxRateBps', 0, 10000], ['discountBps', 0, 10000]] as const) if (!integer(item[key], min, max)) fail('Invalid invoice item amount.')
  }
  if (value.override !== undefined) {
    const p = value.override, bools = ['upiEnabled', 'bankEnabled', 'cashEnabled', 'otherEnabled']
    const limits = { upiId: 200, upiHolder: 160, qr: 45000, bankHolder: 160, bankName: 160, accountNumber: 80, ifsc: 30, branch: 160, otherMethod: 160, instructions: 3000 }
    if (!record(p) || !exact(p, [...bools, ...Object.keys(limits)])) fail('Invalid payment override fields.')
    for (const key of bools) if (typeof p[key] !== 'boolean') fail('Invalid payment override flags.')
    for (const [key, max] of Object.entries(limits)) if (!text(p[key], max)) fail('Invalid payment override content.')
    if ((p.qr !== '' && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(String(p.qr)))
      || (p.upiEnabled && !/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/.test(String(p.upiId)))
      || (p.bankEnabled && (!String(p.bankHolder).trim() || !String(p.bankName).trim() || !/^[0-9]{6,34}$/.test(String(p.accountNumber)) || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(p.ifsc))))
      || (p.otherEnabled && !String(p.otherMethod).trim())) fail('Invalid payment instructions.')
  }
}

interface Counter { baselineSequence: number; lastSequence: number; revision: number }
function counterData(snapshot: AllocationDocument, uid: string): Counter {
  const d = snapshot.data()
  if (!snapshot.exists() || !d || d.ownerId !== uid || d.workspaceId !== uid || d.initializationVersion !== 1
    || !integer(d.baselineSequence, 0, 1e9 - 1) || !integer(d.lastSequence, d.baselineSequence, 1e9 - 1) || !integer(d.revision, 1, Number.MAX_SAFE_INTEGER)) fail('Counter requires trusted initialization or review.')
  return { baselineSequence: d.baselineSequence, lastSequence: d.lastSequence, revision: d.revision }
}
function existingResult(head: AllocationDocument, snap: AllocationDocument, uid: string, requestId: string): InvoiceAllocationResult | null {
  if (!head.exists()) return null
  const h = head.data(), s = snap.data()
  try {
    if (!h || !s || !snap.exists() || h.ownerId !== uid || h.workspaceId !== uid || s.ownerId !== uid || s.workspaceId !== uid || !text(s.contentJson, 220000)) throw new Error('Ownership mismatch.')
    const allocation = allocationIdentity(h, uid, head.id)
    if (!allocation || allocation.requestId !== requestId) throw new Error('Allocation mismatch.')
    return { invoiceId: head.id, requestId, sequence: allocation.sequence, prefix: allocation.prefix }
  } catch { throw new AllocationError('allocation-conflict', 'This invoice belongs to a different or unrecognized allocation request. Nothing was allocated.') }
}
interface Observed { sequence: number; revision: number; baseline: number }
function errorCode(error: unknown) { return record(error) && typeof error.code === 'string' ? error.code : '' }

/** Independent of UI and Firebase setup; counter initialization is intentionally absent. */
export async function allocateInvoice(store: InvoiceAllocationStore, invoiceId: string, requestId: string, input: InvoiceAllocationInput): Promise<InvoiceAllocationResult> {
  const uid = store.ownerId
  if (![uid, invoiceId, requestId].every(identifier)) fail('Invalid owner, invoice or allocation request ID.')
  validate(input)
  // Copy caller-owned containers while preserving SDK Timestamp instances.
  const payload: InvoiceAllocationInput = { header: { ...input.header }, snapshot: { ...input.snapshot }, items: input.items.map(item => ({ ...item })), ...(input.override === undefined ? {} : { override: { ...input.override } }) }
  const root = `workspaces/${uid}`, head = `${root}/invoices/${invoiceId}`, snapshot = `${head}/configuration/snapshot`, counter = `${root}/invoiceCounters/main`
  const metadata = () => ({ schemaVersion: 1, workspaceId: uid, ownerId: uid, revision: 1, createdAt: store.timestamp(), updatedAt: store.timestamp() })
  for (let attempt = 1; attempt <= MAX_ALLOCATION_ATTEMPTS; attempt++) {
    let observed: Observed | undefined, readyToCommit = false
    try {
      const result = await store.transact(async tx => {
        observed = undefined; readyToCommit = false
        validate(payload)
        const h = await tx.get(head), s = await tx.get(snapshot)
        const bindingPath = `${root}/invoiceAllocations/${requestId}`
        const binding = await tx.get(bindingPath)
        const workspace = (await tx.get(root)).data(), access = await tx.get(`accountAccess/${uid}`)
        if (workspace?.ownerId !== uid || (access.exists() && (access.data()?.userId !== uid || access.data()?.status !== 'active'))) throw new AllocationError('allocation-unauthorized', 'Workspace access is not permitted.')
        const committed = existingResult(h, s, uid, requestId)
        if (committed) return committed
        if (s.exists()) fail('An orphan invoice snapshot requires review; allocation was not attempted.')
        if (binding.exists()) throw new AllocationError('allocation-conflict', 'This request ID already belongs to an invoice. Reopen the original request.')
        const c = counterData(await tx.get(counter), uid), pref = (await tx.get(`${root}/settings/invoice`)).data(), client = (await tx.get(`${root}/clients/${payload.header.clientId}`)).data()
        const project = payload.header.projectId === null ? null : (await tx.get(`${root}/projects/${payload.header.projectId}`)).data()
        if (client?.ownerId !== uid || client.workspaceId !== uid || (payload.header.projectId !== null && (!project || project.ownerId !== uid || project.workspaceId !== uid || project.clientId !== payload.header.clientId))) fail('Invalid client or project ownership/reference.')
        const prefix = pref?.invoicePrefix
        if (typeof prefix !== 'string' || !prefixPattern.test(prefix) || pref?.ownerId !== uid || pref.workspaceId !== uid) fail('Invalid workspace invoice prefix.')
        observed = { sequence: c.lastSequence, revision: c.revision, baseline: c.baselineSequence }
        const sequence = c.lastSequence + 1
        const contentJson = JSON.stringify({ ...JSON.parse(payload.snapshot.contentJson), _allocation: { version: 1, invoiceId, requestId } })
        if (contentJson.length > 220000) fail('Snapshot exceeds supported size.')
        validateSnapshotByteSize({ ...payload.snapshot, contentJson })
        const allocation = { version: 1, workspaceId: uid, invoiceId, requestId, prefix, sequence }
        tx.set(head, { ...metadata(), ...payload.header, numberPrefix: prefix, numberSequence: sequence, allocation, itemIds: payload.items.map(item => item.id) })
        tx.set(bindingPath, { identity: allocation, createdAt: store.timestamp() })
        tx.set(snapshot, { ...metadata(), ...payload.snapshot, contentJson })
        for (const [allocationIndex, { id, ...item }] of payload.items.entries()) tx.set(`${head}/items/${id}`, { ...metadata(), ...item, allocationIndex, invoiceRevision: 1 })
        if (payload.override) tx.set(`${head}/configuration/paymentOverride`, { ...metadata(), details: payload.override })
        tx.update(counter, { lastSequence: sequence, lastInvoiceId: invoiceId, revision: c.revision + 1, updatedAt: store.timestamp() })
        readyToCommit = true
        return { invoiceId, requestId, sequence, prefix }
      })
      return result
    } catch (cause) {
      if (cause instanceof AllocationError || !readyToCommit) throw cause
      let current: Counter
      try {
        const h = await store.read(head)
        if (h.exists()) return existingResult(h, await store.read(snapshot), uid, requestId)!
        current = counterData(await store.read(counter), uid)
      } catch (recoveryError) { throw new AllocationError('allocation-recovery-denied', 'Allocation could not be safely confirmed. Check workspace access before retrying.', recoveryError) }
      const eligible = ['permission-denied', 'aborted', 'failed-precondition', 'unavailable', 'deadline-exceeded', 'unknown'].includes(errorCode(cause))
      if (!eligible || !observed || current.baselineSequence !== observed.baseline || current.lastSequence <= observed.sequence || current.revision <= observed.revision) throw new AllocationError('allocation-not-retried', 'Allocation failed; no safe counter advancement was established. Nothing was retried.', cause)
      try {
        const workspace = (await store.read(root)).data(), access = await store.read(`accountAccess/${uid}`)
        const client = (await store.read(`${root}/clients/${payload.header.clientId}`)).data()
        const project = payload.header.projectId === null ? null : (await store.read(`${root}/projects/${payload.header.projectId}`)).data()
        const pref = (await store.read(`${root}/settings/invoice`)).data()
        if (workspace?.ownerId !== uid || (access.exists() && (access.data()?.userId !== uid || access.data()?.status !== 'active'))
          || client?.ownerId !== uid || client.workspaceId !== uid || (payload.header.projectId !== null && (!project || project.ownerId !== uid || project.workspaceId !== uid || project.clientId !== payload.header.clientId))
          || pref?.ownerId !== uid || pref.workspaceId !== uid || typeof pref.invoicePrefix !== 'string' || !prefixPattern.test(pref.invoicePrefix)) fail('Access, invoice prefix or references changed; allocation was not retried.')
      } catch (recoveryError) { throw new AllocationError('allocation-recovery-denied', 'Access or references could not be revalidated; allocation was not retried.', recoveryError) }
      if (attempt === MAX_ALLOCATION_ATTEMPTS) throw new AllocationError('allocation-exhausted', `Invoice allocation stopped after ${MAX_ALLOCATION_ATTEMPTS} attempts. Reopen and retry with the same request ID.`, cause)
    }
  }
  throw new AllocationError('allocation-exhausted', 'Allocation attempts exhausted.')
}
