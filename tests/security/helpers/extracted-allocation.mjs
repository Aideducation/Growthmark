// Test-only compatibility bridge. All barriers, mock identities and faults live here.
import { allocateInvoice, MAX_ALLOCATION_ATTEMPTS } from '../../../src/features/workspace/invoices/allocation.ts'
import { createInvoiceAllocationStore } from '../../../src/features/workspace/invoices/allocation-store.ts'
import { requireEmulators } from '../helpers.mjs'
export { MAX_ALLOCATION_ATTEMPTS }

export async function allocateCandidateInvoice(db, uid, invoiceId, requestId, input, hooks = {}) {
  requireEmulators()
  // Rules-unit-testing supplies the actual emulator identity. This adapter supplies
  // only the Auth interface expected by existing application-side session guards.
  const auth = mockAllocationAuth(db, uid)
  const base = await createInvoiceAllocationStore(auth, db)
  let attempt = 0
  const store = {
    ...base,
    async transact(operation) {
      attempt++
      const result = await base.transact(async tx => {
        let observed
        const writes = []
        const result = await operation({
          async get(path) {
            const snapshot = await tx.get(path)
            if (path.endsWith('/invoiceCounters/main') && snapshot.exists()) {
              const data = snapshot.data()
              observed = { sequence: data.lastSequence, revision: data.revision, baseline: data.baselineSequence }
            }
            return snapshot
          },
          set: (path, data) => writes.push(['set', path, data]),
          update: (path, data) => writes.push(['update', path, data]),
        })
        if (writes.length) {
          await hooks.afterRead?.({ attempt, observed, invoiceId, requestId })
          for (const [method, path, data] of writes) tx[method](path, data)
          await hooks.beforeCommit?.({ attempt, observed })
        }
        return result
      })
      await hooks.afterCommit?.({ attempt, result })
      return result
    },
  }
  return allocateInvoice(store, invoiceId, requestId, input)
}

export function mockAllocationAuth(db, uid) {
  return {
    app: db.app,
    emulatorConfig: { host: '127.0.0.1', port: 9199 },
    currentUser: { uid, email: `${uid}@example.test`, emailVerified: true, getIdTokenResult: async () => ({ claims: { email_verified: true } }) },
  }
}
