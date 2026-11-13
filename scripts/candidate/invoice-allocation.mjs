// LOCAL CANDIDATE ONLY. Not imported by the frontend. No privileged credentials.
import { doc, runTransaction, serverTimestamp, getDocFromServer } from 'firebase/firestore'

const idPattern = /^[A-Za-z0-9_-]{1,128}$/
export const MAX_ALLOCATION_ATTEMPTS = 3
export class AllocationError extends Error {
  constructor(code, message, cause) { super(message, { cause }); this.code = code }
}
function fail(message) { throw new AllocationError('invalid-allocation', message) }
function validate(input) {
  const h = input.header, s = input.snapshot
  if (!h || !s || !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 51) fail('Invalid invoice payload.')
  const keys = ['clientId','projectId','title','state','issueAt','dueAt','terms','notes','manualStatus']
  if (Object.keys(h).some(k => !keys.includes(k)) || !idPattern.test(h.clientId) || (h.projectId !== null && !idPattern.test(h.projectId))) fail('Invalid invoice reference or fields.')
  if (h.state !== 'draft' || !['draft','sent','pending','paid','overdue','cancelled'].includes(h.manualStatus ?? 'draft')) fail('Invalid invoice status.')
  for (const [key, max] of [['title',200],['terms',5000],['notes',5000]]) if (typeof h[key] !== 'string' || h[key].length > max || (key === 'title' && !h[key].trim())) fail('Invalid invoice text.')
  if (typeof h.issueAt?.toMillis !== 'function' || (h.dueAt !== null && (typeof h.dueAt?.toMillis !== 'function' || h.dueAt.toMillis() < h.issueAt.toMillis()))) fail('Invalid invoice dates.')
  if (Object.keys(s).sort().join() !== ['agencyJson','clientJson','contentJson'].sort().join()) fail('Invalid snapshot fields.')
  for (const [key,max] of [['agencyJson',150000],['clientJson',10000],['contentJson',219000]]) {
    if (typeof s[key] !== 'string' || s[key].length > max) fail('Invalid snapshot size.')
    try { const parsed = JSON.parse(s[key]); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || '_allocation' in parsed) fail('Invalid snapshot content.') } catch { fail('Invalid snapshot JSON.') }
  }
  const ids = new Set()
  for (const item of input.items) {
    if (!idPattern.test(item.id) || ids.has(item.id) || Object.keys(item).sort().join() !== ['id','description','quantityMilli','unitPriceMinor','taxRateBps','discountBps'].sort().join()) fail('Invalid invoice item fields.')
    ids.add(item.id)
    if (typeof item.description !== 'string' || !item.description.length || item.description.length > 2000) fail('Invalid invoice item description.')
    for (const [key,min,max] of [['quantityMilli',1,1e9],['unitPriceMinor',0,1e12],['taxRateBps',0,10000],['discountBps',0,10000]]) if (!Number.isSafeInteger(item[key]) || item[key] < min || item[key] > max) fail('Invalid invoice item amount.')
  }
  if (input.override !== undefined) {
    const p = input.override, bools = ['upiEnabled','bankEnabled','cashEnabled','otherEnabled']
    const limits = { upiId:200, upiHolder:160, qr:45000, bankHolder:160, bankName:160, accountNumber:80, ifsc:30, branch:160, otherMethod:160, instructions:3000 }
    if (!p || Object.keys(p).sort().join() !== [...bools,...Object.keys(limits)].sort().join()) fail('Invalid payment override fields.')
    for (const k of bools) if (typeof p[k] !== 'boolean') fail('Invalid payment override flags.')
    for (const [k,max] of Object.entries(limits)) if (typeof p[k] !== 'string' || p[k].length > max) fail('Invalid payment override content.')
    if ((p.qr && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(p.qr)) || (p.upiEnabled && !/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/.test(p.upiId)) || (p.bankEnabled && (!p.bankHolder.trim() || !p.bankName.trim() || !/^[0-9]{6,34}$/.test(p.accountNumber) || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(p.ifsc))) || (p.otherEnabled && !p.otherMethod.trim())) fail('Invalid payment instructions.')
  }
}
function counterData(snapshot, uid) {
  const d = snapshot.data()
  if (!snapshot.exists() || d.ownerId !== uid || d.workspaceId !== uid || d.initializationVersion !== 1 || !Number.isSafeInteger(d.baselineSequence) || d.baselineSequence < 0 || !Number.isSafeInteger(d.lastSequence) || d.lastSequence < d.baselineSequence || d.lastSequence >= 1e9 || !Number.isSafeInteger(d.revision) || d.revision < 1) fail('Counter requires trusted initialization or review.')
  return d
}
function existingResult(head, snap, uid, requestId) {
  if (!head.exists()) return null
  const h = head.data()
  let allocation
  try { allocation = JSON.parse(snap.data()?.contentJson)._allocation } catch { /* fail closed below */ }
  if (h.ownerId !== uid || h.workspaceId !== uid || snap.data()?.ownerId !== uid || snap.data()?.workspaceId !== uid || allocation?.requestId !== requestId || allocation?.invoiceId !== head.id || allocation?.version !== 1 || !Number.isSafeInteger(h.numberSequence) || h.numberSequence < 1 || !/^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/.test(h.numberPrefix)) throw new AllocationError('allocation-conflict','This invoice belongs to a different or unrecognized allocation request. Nothing was allocated.')
  return { invoiceId: head.id, requestId, sequence: h.numberSequence, prefix: h.numberPrefix }
}

// hooks provide deterministic emulator transport-fault/concurrency diagnostics only.
export async function allocateCandidateInvoice(db, uid, invoiceId, requestId, input, hooks = {}) {
  if (db.app.options.projectId !== 'demo-growthmark-security-tests' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180' || process.env.GCLOUD_PROJECT !== 'demo-growthmark-security-tests') fail('Isolated test emulator required.')
  if (![uid,invoiceId,requestId].every(v => typeof v === 'string' && idPattern.test(v))) fail('Invalid owner, invoice or allocation request ID.')
  const payload = structuredClonePayload(input)
  validate(payload)
  const root = ['workspaces',uid], head = doc(db,...root,'invoices',invoiceId), snapshot = doc(head,'configuration','snapshot'), counter = doc(db,...root,'invoiceCounters','main')
  const metadata = () => ({ schemaVersion:1, workspaceId:uid, ownerId:uid, revision:1, createdAt:serverTimestamp(), updatedAt:serverTimestamp() })
  for (let attempt = 1; attempt <= MAX_ALLOCATION_ATTEMPTS; attempt++) {
    let observed, readyToCommit = false
    try {
      const result = await runTransaction(db, async tx => {
        observed = undefined; readyToCommit = false
        validate(payload)
        const h = await tx.get(head), s = await tx.get(snapshot)
        const workspace = await tx.get(doc(db,...root)), access = await tx.get(doc(db,'accountAccess',uid))
        if (workspace.data()?.ownerId !== uid || (access.exists() && (access.data().userId !== uid || access.data().status !== 'active'))) throw new AllocationError('allocation-unauthorized','Workspace access is not permitted.')
        const committed = existingResult(h,s,uid,requestId)
        if (committed) return committed
        if (s.exists()) fail('An orphan invoice snapshot requires review; allocation was not attempted.')
        const c = counterData(await tx.get(counter),uid), pref = await tx.get(doc(db,...root,'settings','invoice')), client = await tx.get(doc(db,...root,'clients',payload.header.clientId))
        const project = payload.header.projectId === null ? null : await tx.get(doc(db,...root,'projects',payload.header.projectId))
        if (client.data()?.ownerId !== uid || client.data()?.workspaceId !== uid || (project && (project.data()?.ownerId !== uid || project.data()?.workspaceId !== uid || project.data()?.clientId !== payload.header.clientId))) fail('Invalid client or project ownership/reference.')
        const prefix = pref.data()?.invoicePrefix
        if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/.test(prefix ?? '') || pref.data()?.ownerId !== uid || pref.data()?.workspaceId !== uid) fail('Invalid workspace invoice prefix.')
        observed = { sequence:c.lastSequence, revision:c.revision, baseline:c.baselineSequence }
        await hooks.afterRead?.({ attempt, observed, invoiceId, requestId })
        const sequence = c.lastSequence + 1
        const contentJson = JSON.stringify({ ...JSON.parse(payload.snapshot.contentJson), _allocation:{ version:1, invoiceId, requestId } })
        if (contentJson.length > 220000) fail('Snapshot exceeds supported size.')
        tx.set(head,{ ...metadata(),...payload.header,numberPrefix:prefix,numberSequence:sequence })
        tx.set(snapshot,{ ...metadata(),...payload.snapshot,contentJson })
        for (const {id,...item} of payload.items) tx.set(doc(head,'items',id),{ ...metadata(),...item })
        if (payload.override) tx.set(doc(head,'configuration','paymentOverride'),{ ...metadata(),details:payload.override })
        tx.update(counter,{ lastSequence:sequence,lastInvoiceId:invoiceId,revision:c.revision+1,updatedAt:serverTimestamp() })
        readyToCommit = true
        await hooks.beforeCommit?.({ attempt, observed })
        return { invoiceId,requestId,sequence,prefix }
      }, { maxAttempts:1 })
      await hooks.afterCommit?.({ attempt,result })
      return result
    } catch (cause) {
      if (cause instanceof AllocationError || !readyToCommit) throw cause
      // Read from server: never recognize success using a pending local write/cache.
      let h, s, current
      try {
        h = await getDocFromServer(head)
        if (h.exists()) { s = await getDocFromServer(snapshot); return existingResult(h,s,uid,requestId) }
        current = counterData(await getDocFromServer(counter),uid)
      } catch (recoveryError) { throw new AllocationError('allocation-recovery-denied','Allocation could not be safely confirmed. Check workspace access before retrying.',recoveryError) }
      const eligible = ['permission-denied','aborted','failed-precondition','unavailable','deadline-exceeded','unknown'].includes(cause.code)
      if (!eligible || !observed || current.baselineSequence !== observed.baseline || current.lastSequence <= observed.sequence || current.revision <= observed.revision) throw new AllocationError('allocation-not-retried','Allocation failed; no safe counter advancement was established. Nothing was retried.',cause)
      // Counter movement alone cannot authorize a retry if access/references changed.
      try {
        const workspace = await getDocFromServer(doc(db,...root)), access = await getDocFromServer(doc(db,'accountAccess',uid))
        const client = await getDocFromServer(doc(db,...root,'clients',payload.header.clientId))
        const project = payload.header.projectId === null ? null : await getDocFromServer(doc(db,...root,'projects',payload.header.projectId))
        const pref = await getDocFromServer(doc(db,...root,'settings','invoice'))
        if (workspace.data()?.ownerId !== uid || (access.exists() && (access.data().userId !== uid || access.data().status !== 'active')) || client.data()?.ownerId !== uid || client.data()?.workspaceId !== uid || (project && (project.data()?.ownerId !== uid || project.data()?.workspaceId !== uid || project.data()?.clientId !== payload.header.clientId)) || pref.data()?.ownerId !== uid || pref.data()?.workspaceId !== uid || !/^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/.test(pref.data()?.invoicePrefix??'')) fail('Access, invoice prefix or references changed; allocation was not retried.')
      } catch (recoveryError) { throw new AllocationError('allocation-recovery-denied','Access or references could not be revalidated; allocation was not retried.',recoveryError) }
      if (attempt === MAX_ALLOCATION_ATTEMPTS) throw new AllocationError('allocation-exhausted',`Invoice allocation stopped after ${MAX_ALLOCATION_ATTEMPTS} attempts. Reopen and retry with the same request ID.`,cause)
    }
  }
  throw new AllocationError('allocation-exhausted','Allocation attempts exhausted.')
}
// Preserve SDK Timestamp prototypes while preventing caller mutation of submitted input.
function structuredClonePayload(input) {
  if (!input || typeof input !== 'object') fail('Invalid invoice payload.')
  return { header:{...input.header},snapshot:{...input.snapshot},items:input.items?.map(x=>({...x})),...(input.override === undefined ? {} : {override:{...input.override}}) }
}
