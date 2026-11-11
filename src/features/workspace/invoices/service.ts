import type { Auth } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'
import { collection, doc, getDoc, getDocs, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore'
import { recordOwner } from '../record-service.ts'
import { calculateInvoice, validateAgency, validateDraft } from './model.ts'
import type { Agency, InvoiceDraft } from './model.ts'

function metadata(uid: string) { return { schemaVersion: 1, workspaceId: uid, ownerId: uid, revision: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp() } }
function revision(existing: { revision?: unknown }, expected?: number) { if (existing.revision !== expected) throw new Error('This record changed in another window. Close and reopen it before saving.') }
export async function loadAgency(auth: Auth, db: Firestore): Promise<{ agency: Agency; revision: number } | null> {
  const user = await recordOwner(auth, db), result = await getDoc(doc(db, 'workspaces', user.uid, 'settings', 'agency'))
  if (!result.exists()) return null
  if (result.data().ownerId !== user.uid) throw new Error('Invalid agency ownership.')
  return { agency: validateAgency(JSON.parse(result.data().profileJson)), revision: result.data().revision }
}
export async function saveAgency(auth: Auth, db: Firestore, agency: Agency, expected?: number) {
  const user = await recordOwner(auth, db), profileJson = JSON.stringify(validateAgency(agency))
  const ref = doc(db, 'workspaces', user.uid, 'settings', 'agency')
  await runTransaction(db, async tx => {
    const workspace = await tx.get(doc(db, 'workspaces', user.uid)), current = await tx.get(ref)
    if (workspace.data()?.ownerId !== user.uid || auth.currentUser?.uid !== user.uid) throw new Error('Workspace ownership changed.')
    revision(current.data() ?? {}, expected)
    if (current.exists()) tx.update(ref, { profileJson, revision: expected! + 1, updatedAt: serverTimestamp() })
    else tx.set(ref, { ...metadata(user.uid), profileJson })
  })
}
export async function loadInvoiceSnapshot(auth: Auth, db: Firestore, id: string): Promise<{ draft: InvoiceDraft; revision: number } | null> {
  const user = await recordOwner(auth, db)
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(id)) throw new Error('Invalid invoice identifier.')
  const result = await getDoc(doc(db, 'workspaces', user.uid, 'invoices', id, 'configuration', 'snapshot'))
  if (!result.exists()) return null
  if (result.data().ownerId !== user.uid) throw new Error('Invalid invoice ownership.')
  const data = result.data()
  return { revision: data.revision, draft: validateDraft({ ...JSON.parse(data.contentJson), agency: JSON.parse(data.agencyJson), client: JSON.parse(data.clientJson) }) }
}
/** Header, canonical estimate items and frozen snapshot commit together. No issued numbers or payments. */
export async function saveAdvancedDraft(auth: Auth, db: Firestore, draft: InvoiceDraft, clientId: string, id?: string, expectedHead?: number, expectedSnapshot?: number) {
  const user = await recordOwner(auth, db), valid = validateDraft(draft), totals = calculateInvoice(valid)
  if (valid.currency !== (await getDoc(doc(db, 'workspaces', user.uid))).data()?.currency) throw new Error('Use your workspace currency. Mixed-currency reporting is not supported yet.')
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(clientId) || id && !/^[A-Za-z0-9_-]{1,150}$/.test(id)) throw new Error('Invalid client or invoice identifier.')
  const head = id ? doc(db, 'workspaces', user.uid, 'invoices', id) : doc(collection(db, 'workspaces', user.uid, 'invoices'))
  const snap = doc(head, 'configuration', 'snapshot')
  const oldItems = await getDocs(collection(head, 'items'))
  if (oldItems.size > 100) throw new Error('This invoice exceeds the supported edit size. No data was changed.')
  const { agency, client, ...content } = valid
  const agencyJson = JSON.stringify(agency), clientJson = JSON.stringify(client), contentJson = JSON.stringify(content)
  await runTransaction(db, async tx => {
    const current = await tx.get(head), snapshot = await tx.get(snap), workspace = await tx.get(doc(db, 'workspaces', user.uid)), customer = await tx.get(doc(db, 'workspaces', user.uid, 'clients', clientId))
    if (workspace.data()?.ownerId !== user.uid || !customer.exists() || customer.data().ownerId !== user.uid || auth.currentUser?.uid !== user.uid) throw new Error('Client or workspace ownership could not be verified.')
    revision(current.data() ?? {}, expectedHead); revision(snapshot.data() ?? {}, expectedSnapshot)
    if (current.exists() && (current.data().state !== 'draft' || current.data().clientId !== clientId)) throw new Error('Only editable drafts for the same client can be saved.')
    if (snapshot.exists() && (snapshot.data().agencyJson !== agencyJson || snapshot.data().clientJson !== clientJson)) throw new Error('Saved agency and client snapshots are frozen. Create a new draft to use different details.')
    // Read every existing item before writing, so the transaction detects concurrent edits.
    for (const item of oldItems.docs) await tx.get(item.ref)
    const payload = { title: valid.title, clientId, projectId: current.data()?.projectId ?? null, state: 'draft', issueAt: Timestamp.fromDate(new Date(valid.date + 'T00:00:00Z')), dueAt: valid.due ? Timestamp.fromDate(new Date(valid.due + 'T00:00:00Z')) : null, terms: valid.terms, notes: valid.notes }
    if (current.exists()) tx.update(head, { ...payload, revision: expectedHead! + 1, updatedAt: serverTimestamp() })
    else tx.set(head, { ...metadata(user.uid), ...payload })
    if (snapshot.exists()) tx.update(snap, { contentJson, revision: expectedSnapshot! + 1, updatedAt: serverTimestamp() })
    else tx.set(snap, { ...metadata(user.uid), agencyJson, clientJson, contentJson })
    const retained = new Set(valid.lines.map(line => `advanced-${line.id}`))
    if (totals.charges) retained.add('advanced-charges')
    for (const item of oldItems.docs) if (!retained.has(item.id)) tx.delete(item.ref)
    function summary(id: string, description: string, amount: number) {
      const previous = oldItems.docs.find(item => item.id === id)
      const payload = { description, quantityMilli: 1000, unitPriceMinor: amount, taxRateBps: 0, discountBps: 0 }
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
