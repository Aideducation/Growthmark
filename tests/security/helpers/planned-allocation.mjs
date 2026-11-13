// Test-only: capture actual allocator writes without committing, for direct SDK attacks.
import { allocateInvoice } from '../../../src/features/workspace/invoices/allocation.ts'
import { createInvoiceAllocationStore } from '../../../src/features/workspace/invoices/allocation-store.ts'
import { mockAllocationAuth } from './extracted-allocation.mjs'
export async function plannedAllocation(db,uid,id,requestId,input) {
  const base=await createInvoiceAllocationStore(mockAllocationAuth(db,uid),db),writes=[]
  await allocateInvoice({...base,transact:operation=>base.transact(tx=>operation({...tx,set:(path,data)=>writes.push(['set',path,data]),update:(path,data)=>writes.push(['update',path,data])}))},id,requestId,input)
  return writes
}
export async function commitPlanned(db,writes) {
  const {doc,writeBatch}=await import('firebase/firestore')
  const batch=writeBatch(db)
  for(const [method,path,data]of writes)batch[method](doc(db,path),data)
  await batch.commit()
}
