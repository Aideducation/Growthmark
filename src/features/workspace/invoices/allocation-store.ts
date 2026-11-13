import type { Auth } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'
import { doc, getDocFromServer, runTransaction, serverTimestamp } from 'firebase/firestore'
import { recordOwner } from '../record-service.ts'
import type { InvoiceAllocationStore } from './allocation-types.ts'

/** Uses the application's existing verified-owner and matching Firebase-instance checks. */
export async function createInvoiceAllocationStore(auth: Auth, db: Firestore): Promise<InvoiceAllocationStore> {
  const ownerId = (await recordOwner(auth, db)).uid
  async function checkIdentity() {
    if ((await recordOwner(auth, db)).uid !== ownerId) throw new Error('Your session changed. Reopen the invoice before saving.')
  }
  const store: InvoiceAllocationStore = {
    ownerId,
    timestamp: serverTimestamp,
    async read(path) {
      await checkIdentity()
      const value = await getDocFromServer(doc(db, path))
      await checkIdentity()
      return value
    },
    async transact(operation) {
      await checkIdentity()
      const result = await runTransaction(db, async transaction => {
        await checkIdentity()
        const result = await operation({
          get: path => transaction.get(doc(db, path)),
          set: (path, data) => { transaction.set(doc(db, path), data) },
          update: (path, data) => { transaction.update(doc(db, path), data) },
        })
        await checkIdentity()
        return result
      }, { maxAttempts: 1 })
      await checkIdentity()
      return result
    },
  }
  return Object.freeze(store)
}
