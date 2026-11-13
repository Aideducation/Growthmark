// Administrative/test module only. Never imported by src or a browser entry point.
// Deliberately refuses all real Firebase projects. No credentials are accepted.
import { collection, doc, getDocs, runTransaction, serverTimestamp } from 'firebase/firestore'

export function reviewHistory(inventory, externalReferences, review) {
  if (review?.complete !== true || !review.reviewer?.trim() || !Array.isArray(externalReferences)) throw new Error('Complete, named historical review required.')
  let baseline = 0
  const references = new Map()
  for (const record of [...inventory, ...externalReferences]) {
    if (!record.id || !Array.isArray(record.references) || !Array.isArray(record.sequences)) throw new Error('Unreviewed history.')
    for (const sequence of record.sequences) {
      if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence >= 1000000000) throw new Error('Invalid historical sequence.')
      baseline = Math.max(baseline, sequence)
    }
    for (const reference of record.references) {
      const parsed = /^([A-Za-z0-9][A-Za-z0-9-]{0,19})-([0-9]+)$/.exec(reference)
      if (!parsed) throw new Error(`Ambiguous historical reference: ${reference}`)
      const sequence = Number(parsed[2])
      if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence >= 1000000000) throw new Error('Invalid historical reference sequence.')
      const normalized = `${parsed[1].toUpperCase()}-${sequence}`
      if (references.has(normalized) && references.get(normalized) !== record.id) throw new Error(`Duplicate historical reference: ${reference}`)
      references.set(normalized, record.id)
      baseline = Math.max(baseline, sequence)
    }
  }
  return { baseline, reviewer: review.reviewer.trim(), recordCount: inventory.length }
}

export async function initializeEmulatorCounter(db, uid, reviewedInventory, externalReferences, review) {
  if (db.app.options.projectId !== 'demo-growthmark-security-tests'
    || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180'
    || process.env.GCLOUD_PROJECT !== 'demo-growthmark-security-tests') throw new Error('Isolated test emulator required.')
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error('Invalid owner ID.')
  // Caller must hold an isolated rules-disabled test context. Ordinary users cannot create counters.
  const invoices = await getDocs(collection(db, 'workspaces', uid, 'invoices'))
  const actual = invoices.docs.map(row => row.id).sort()
  if (JSON.stringify(actual) !== JSON.stringify(reviewedInventory.map(row => row.id).sort())) throw new Error('Inventory does not cover every invoice.')
  const report = reviewHistory(reviewedInventory, externalReferences, review)
  const ref = doc(db, 'workspaces', uid, 'invoiceCounters', 'main')
  await runTransaction(db, async tx => {
    const existing = await tx.get(ref), workspace = await tx.get(doc(db, 'workspaces', uid))
    if (existing.exists()) throw new Error('Counter already initialized; refusing overwrite.')
    if (workspace.data()?.ownerId !== uid) throw new Error('Invalid workspace.')
    tx.set(ref, { schemaVersion: 1, workspaceId: uid, ownerId: uid, revision: 1,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), initializationVersion: 1,
      baselineSequence: report.baseline, lastSequence: report.baseline, lastInvoiceId: null })
  })
  return report
}
