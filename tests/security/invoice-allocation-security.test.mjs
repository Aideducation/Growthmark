import { before, beforeEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc, getDoc, collection, getDocs, writeBatch, setDoc, updateDoc, deleteDoc, deleteField, serverTimestamp } from 'firebase/firestore'
import { requireEmulators, PROJECT, identity, bootstrap, client, project, settingsFactories, meta, draft } from './helpers.mjs'
import { allocateInvoice } from '../../src/features/workspace/invoices/allocation.ts'
import { createInvoiceAllocationStore } from '../../src/features/workspace/invoices/allocation-store.ts'
import { mockAllocationAuth } from './helpers/extracted-allocation.mjs'
import { allocationIdentity } from '../../src/features/workspace/invoices/allocation-identity.ts'

let env, a, b, uid, index=0
const path=(db,id,...parts)=>doc(db,'workspaces',id,...parts)
const stamp=revision=>({revision,updatedAt:serverTimestamp()})
const details=()=>({upiEnabled:false,upiId:'',upiHolder:'',qr:'',bankEnabled:false,bankHolder:'',bankName:'',accountNumber:'',ifsc:'',branch:'',cashEnabled:true,otherEnabled:false,otherMethod:'',instructions:''})
function payload(count=2){
  const {schemaVersion,workspaceId,ownerId,createdAt,updatedAt,revision,...header}=draft(uid)
  return {header,snapshot:{agencyJson:'{}',clientJson:'{}',contentJson:'{}'},items:Array.from({length:count},(_,i)=>({id:'item-'+i,description:'Service',quantityMilli:1000,unitPriceMinor:100,taxRateBps:0,discountBps:0})),override:details()}
}
// Capture actual application writes without committing them, then send a directly
// mutated SDK batch. Denial fixtures start from the same known-valid transaction.
async function plan(id,count=2,requestId='request-'+id){
  const base=await createInvoiceAllocationStore(mockAllocationAuth(a,uid),a),writes=[]
  await allocateInvoice({...base,transact:operation=>base.transact(tx=>operation({...tx,set:(p,d)=>writes.push(['set',p,d]),update:(p,d)=>writes.push(['update',p,d])}))},id,requestId,payload(count))
  return writes
}
async function commit(writes,db=a){const batch=writeBatch(db);for(const [method,p,data]of writes)batch[method](doc(db,p),data);await batch.commit()}
async function noPartial(id,requestId='request-'+id){
  for(const parts of [['invoices',id],['invoices',id,'configuration','snapshot'],['invoices',id,'configuration','paymentOverride'],['invoiceAllocations',requestId]])assert.equal((await getDoc(path(a,uid,...parts))).exists(),false)
  assert.equal((await getDocs(collection(a,'workspaces',uid,'invoices',id,'items'))).size,0)
}
async function edit(id,patch={},contentJson='{}'){
  const h=path(a,uid,'invoices',id),s=doc(h,'configuration','snapshot'),header=(await getDoc(h)).data(),snapshot=(await getDoc(s)).data()
  const rows=await getDocs(collection(h,'items')),batch=writeBatch(a)
  batch.update(h,{...patch,...stamp(header.revision+1)});batch.update(s,{contentJson,...stamp(snapshot.revision+1)})
  for(const row of rows.docs)batch.update(row.ref,{invoiceRevision:header.revision+1,...stamp(row.data().revision+1)})
  await batch.commit()
}
before(async()=>{requireEmulators();env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8180,rules:await readFile(process.env.GROWTHMARK_INVOICE_RULES_FILE === 'firestore.release.rules' ? 'firestore.release.rules' : 'firestore.invoice-workflow.candidate.rules','utf8')}})})
beforeEach(async()=>{
  await env.clearFirestore();uid='protected-a-'+(++index);a=identity(env,uid);b=identity(env,'protected-b-'+index)
  await bootstrap(a,uid)
  await setDoc(path(a,uid,'clients','client'),client(uid));await setDoc(path(a,uid,'projects','project'),project(uid));await setDoc(path(a,uid,'settings','invoice'),settingsFactories.invoice(uid))
  await env.withSecurityRulesDisabled(async ctx=>{const db=ctx.firestore();await writeBatch(db).set(path(db,uid,'invoiceCounters','main'),{...meta(uid),initializationVersion:1,baselineSequence:47,lastSequence:47,lastInvoiceId:null}).commit()})
})
after(async()=>env?.cleanup())

test('protected identity and complete eight-item creation succeed with active account, project and override',async()=>{
  await env.withSecurityRulesDisabled(ctx=>writeBatch(ctx.firestore()).set(doc(ctx.firestore(),'accountAccess',uid),{userId:uid,status:'active'}).commit())
  await commit(await plan('valid',8))
  const h=(await getDoc(path(a,uid,'invoices','valid'))).data(),binding=(await getDoc(path(a,uid,'invoiceAllocations','request-valid'))).data()
  assert.deepEqual(binding.identity,h.allocation);assert.equal(h.allocation.workspaceId,uid);assert.equal(h.allocation.sequence,48)
  assert.equal((await getDocs(collection(a,'workspaces',uid,'invoices','valid','items'))).size,8)
})

for(const mode of ['snapshot','all-items','first-item','middle-item','last-item','identity','counter','invoice'])test('direct SDK denies missing '+mode+' and leaves no partial writes',async()=>{
  const id='missing-'+mode,original=await plan(id,3),before=(await getDoc(path(a,uid,'invoiceCounters','main'))).data()
  const writes=original.filter(([,p])=>!(mode==='snapshot'?p.endsWith('/configuration/snapshot'):mode==='all-items'?p.includes('/items/'):mode==='first-item'?p.endsWith('/items/item-0'):mode==='middle-item'?p.endsWith('/items/item-1'):mode==='last-item'?p.endsWith('/items/item-2'):mode==='identity'?p.includes('/invoiceAllocations/'):mode==='counter'?p.endsWith('/invoiceCounters/main'):p.endsWith('/invoices/'+id)))
  await assertFails(commit(writes));await noPartial(id)
  assert.deepEqual((await getDoc(path(a,uid,'invoiceCounters','main'))).data(),before)
})

test('allocation identity cannot be replaced, removed, rebound or deleted by its owner',async()=>{
  await commit(await plan('immutable'));const header=(await getDoc(path(a,uid,'invoices','immutable'))).data()
  for(const patch of [{allocation:deleteField()},{allocation:null},{allocation:{...header.allocation,requestId:'forged'}},{allocation:{...header.allocation,workspaceId:'foreign'}},{numberSequence:49}])await assertFails(edit('immutable',patch))
  const binding=path(a,uid,'invoiceAllocations','request-immutable')
  await assertFails(updateDoc(binding,{'identity.requestId':'forged'}));await assertFails(deleteDoc(binding));await assertFails(deleteDoc(path(a,uid,'invoices','immutable')))
  assert.deepEqual((await getDoc(path(a,uid,'invoices','immutable'))).data(),header)
})

test('editable JSON marker cannot forge recovery identity, including uncertain successful commit',async()=>{
  await commit(await plan('recover'))
  const base=await createInvoiceAllocationStore(mockAllocationAuth(a,uid),a)
  for(const contentJson of ['{}',JSON.stringify({_allocation:{version:1,invoiceId:'recover',requestId:'forged'}})]){
    await edit('recover',{},contentJson)
    assert.equal((await allocateInvoice(base,'recover','request-recover',payload())).sequence,48)
    await assert.rejects(allocateInvoice(base,'recover','forged',payload()),e=>e.code==='allocation-conflict')
  }
  assert.equal((await getDoc(path(a,uid,'invoiceCounters','main'))).data().lastSequence,48)
})

test('counter-only increments, duplicate sequences and reused request IDs are denied',async()=>{
  const valid=await plan('first');await commit(valid)
  await assertFails(updateDoc(path(a,uid,'invoiceCounters','main'),{lastSequence:49,lastInvoiceId:'absent',...stamp(3)}))
  const duplicate=await plan('duplicate')
  for(const write of duplicate){const d=write[2];if(d.numberSequence)d.numberSequence=48;if(d.allocation)d.allocation={...d.allocation,sequence:48};if(d.identity)d.identity={...d.identity,sequence:48};if(d.lastSequence)d.lastSequence=48}
  await assertFails(commit(duplicate));await noPartial('duplicate')
  const reused=await plan('reused')
  for(const write of reused){if(write[2].allocation)write[2].allocation.requestId='request-first';if(write[2].identity){write[2].identity.requestId='request-first';write[1]=write[1].replace('request-reused','request-first')}}
  await assertFails(commit(reused));await noPartial('reused')
})

test('cross-workspace identity reads, mutations and complete foreign batches remain denied',async()=>{
  const writes=await plan('foreign');await assertFails(commit(writes,b));await noPartial('foreign');await commit(writes)
  for(const parts of [['invoiceAllocations','request-foreign'],['invoices','foreign'],['invoices','foreign','configuration','paymentOverride']]){
    await assertFails(getDoc(path(b,uid,...parts)));await assertFails(deleteDoc(path(b,uid,...parts)))
  }
})

test('header-only edits and deletion of required items are denied; coordinated edits preserve identity',async()=>{
  await commit(await plan('edit'));const before=(await getDoc(path(a,uid,'invoices','edit'))).data().allocation
  await assertFails(updateDoc(path(a,uid,'invoices','edit'),{title:'Uncoordinated',...stamp(2)}))
  await assertFails(deleteDoc(path(a,uid,'invoices','edit','items','item-1')))
  await edit('edit',{title:'Edited',manualStatus:'paid'})
  assert.deepEqual((await getDoc(path(a,uid,'invoices','edit'))).data().allocation,before)
  assert.equal((await getDocs(collection(a,'workspaces',uid,'payments'))).size,0)
})

test('oversized manifests, duplicate item IDs and extra unlisted item writes are denied',async()=>{
  const base=await createInvoiceAllocationStore(mockAllocationAuth(a,uid),a)
  await assert.rejects(allocateInvoice(base,'oversized','request-oversized',payload(9)),/1–8 item records/)
  for(const mode of ['duplicate','unlisted','oversized']){
    const id='manifest-'+mode,writes=await plan(id,8),head=writes.find(([,p])=>p.endsWith('/invoices/'+id))[2]
    if(mode==='duplicate')head.itemIds[1]=head.itemIds[0]
    else {const row=writes.find(([,p])=>p.endsWith('/items/item-7'));writes.push(['set',row[1].replace('item-7','item-8'),{...row[2],allocationIndex:8}]);if(mode==='oversized')head.itemIds.push('item-8')}
    await assertFails(commit(writes));await noPartial(id)
  }
})

test('structured allocation validator rejects invalid fields and never upgrades JSON-only legacy invoices',()=>{
  const identity={version:1,workspaceId:uid,invoiceId:'invoice',requestId:'request',prefix:'INV',sequence:48}
  const header={allocation:identity,numberPrefix:'INV',numberSequence:48}
  assert.deepEqual(allocationIdentity(header,uid,'invoice'),identity)
  assert.equal(allocationIdentity({numberPrefix:'INV',numberSequence:48},uid,'invoice'),undefined)
  for(const a of [null,{}, {...identity,version:2},{...identity,requestId:''},{...identity,invoiceId:'other'},{...identity,workspaceId:'other'},{...identity,sequence:49},{...identity,prefix:'OTHER'},{...identity,admin:true}])assert.throws(()=>allocationIdentity({...header,allocation:a},uid,'invoice'),/Invalid protected/)
})

test('UTF-8 snapshot byte budget is checked before a transaction or allocation',async()=>{
  const p=payload(),base=await createInvoiceAllocationStore(mockAllocationAuth(a,uid),a)
  p.snapshot.agencyJson=JSON.stringify({value:'界'.repeat(149000)})
  p.snapshot.contentJson=JSON.stringify({value:'界'.repeat(210000)})
  let attempts=0
  await assert.rejects(allocateInvoice({...base,transact:()=>{attempts++;throw new Error('Must not transact')}},'large','request-large',p),/UTF-8 byte size/)
  assert.equal(attempts,0);await noPartial('large','request-large')
})
