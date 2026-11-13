import { before, beforeEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, runTransaction, writeBatch, serverTimestamp } from 'firebase/firestore'
import { PROJECT, requireEmulators, identity, meta, bootstrap, client, project, draft, item, settingsFactories } from './helpers.mjs'
// Current rules must exercise the current TypeScript app allocator. The archived
// pre-Step-6 Node candidate intentionally does not implement the protected schema.
import { allocateCandidateInvoice, MAX_ALLOCATION_ATTEMPTS } from './helpers/extracted-allocation.mjs'
import { initializeEmulatorCounter, reviewHistory } from '../../scripts/admin/invoice-counter-emulator.mjs'
import { plannedAllocation, commitPlanned } from './helpers/planned-allocation.mjs'

let env, a, b, A, B, testIndex = 0
const base = uid => ['workspaces', uid]
const ref = (db, uid, ...parts) => doc(db, ...base(uid), ...parts)
const stamp = revision => ({ revision, updatedAt: serverTimestamp() })
const details = () => ({ upiEnabled: false, upiId: '', upiHolder: '', qr: '', bankEnabled: false, bankHolder: '', bankName: '', accountNumber: '', ifsc: '', branch: '', cashEnabled: true, otherEnabled: false, otherMethod: '', instructions: '' })
const snapshot = uid => ({ ...meta(uid), agencyJson: '{"name":"Original","bankName":"Original bank"}', clientJson: '{"name":"Original client"}', contentJson: '{}' })
async function initialize(uid, inventory = [], external = []) {
  return env.withSecurityRulesDisabled(ctx => initializeEmulatorCounter(ctx.firestore(), uid, inventory, external, { complete: true, reviewer: 'Isolated emulator review' }))
}
function input(uid, count=1, override=false) {
  const {schemaVersion,workspaceId,ownerId,createdAt,updatedAt,revision,...header}=draft(uid)
  return {header:{...header,manualStatus:'draft'},snapshot:{agencyJson:'{"name":"Original","bankName":"Original bank"}',clientJson:'{"name":"Original client"}',contentJson:'{}'},items:Array.from({length:count},(_,i)=>({id:'line-'+i,description:'Consulting',quantityMilli:1000,unitPriceMinor:10000,taxRateBps:0,discountBps:0})),...(override?{override:details()}: {})}
}
async function allocate(db,uid,id,{count=1,override=false,barrier,projectId='project',invalidItem=false,requestId='request-'+id,hooks={}}={}) {
  const payload=input(uid,count,override);payload.header.projectId=projectId
  if(invalidItem)payload.items[0].quantityMilli=-1
  const result=await allocateCandidateInvoice(db,uid,id,requestId,payload,{...hooks,afterRead:async info=>{await hooks.afterRead?.(info);if(barrier)await barrier(info)}})
  return result.sequence
}
async function removeCounter(uid){await env.withSecurityRulesDisabled(ctx=>deleteDoc(ref(ctx.firestore(),uid,'invoiceCounters','main')))}
async function seedFirst(){return allocate(a,A,'first',{count:8,override:true})}
function edit(db, uid, id, patch = {}, override) {
  return runTransaction(db, async tx => {
    const head = ref(db, uid, 'invoices', id), snap = doc(head, 'configuration', 'snapshot'), payment = doc(head, 'configuration', 'paymentOverride')
    const h = await tx.get(head), s = await tx.get(snap), p = await tx.get(payment)
    const rows = await getDocs(collection(db, ...base(uid), 'invoices', id, 'items'))
    for (const row of rows.docs) await tx.get(row.ref)
    tx.update(head, { ...patch, ...stamp(h.data().revision + 1) })
    tx.update(snap, stamp(s.data().revision + 1))
    if (h.data().allocation) for (const row of rows.docs) tx.update(row.ref, { invoiceRevision: h.data().revision + 1, ...stamp(row.data().revision + 1) })
    if (override) {
      if (p.exists()) tx.update(payment, { details: override, ...stamp(p.data().revision + 1) })
      else tx.set(payment, { ...meta(uid), details: override })
    }
  })
}
before(async () => {
 requireEmulators();env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8180,rules:await readFile(process.env.GROWTHMARK_INVOICE_RULES_FILE === 'firestore.release.rules' ? 'firestore.release.rules' : 'firestore.invoice-workflow.candidate.rules','utf8')}})
})
beforeEach(async () => {
 await env.clearFirestore();A='invoice-a-'+(++testIndex);B='invoice-b-'+testIndex;a=identity(env,A);b=identity(env,B)
 for(const [db,uid]of [[a,A],[b,B]]){
  await bootstrap(db,uid);await setDoc(ref(db,uid,'clients','client'),client(uid));await setDoc(ref(db,uid,'projects','project'),project(uid));await setDoc(ref(db,uid,'settings','invoice'),settingsFactories.invoice(uid));await setDoc(ref(db,uid,'settings','agency'),{...meta(uid),profileJson:'{"name":"Saved agency"}'})
  await initialize(uid,[],uid===A?[{id:'reviewed-external-history',references:['OLD-000047'],sequences:[]}]:[])
 }
})
after(async () => env?.cleanup())

test('history review: zero, leading zeros, mixed prefixes, duplicates and incomplete review', () => {
  const review = { complete: true, reviewer: 'Reviewer' }
  assert.equal(reviewHistory([], [], review).baseline, 0)
  assert.equal(reviewHistory([{ id: 'a', references: ['OLD-000047'], sequences: [] }, { id: 'b', references: ['NEW-12'], sequences: [60] }], [], review).baseline, 60)
  assert.throws(() => reviewHistory([], [], { ...review, complete: false }))
  assert.throws(() => reviewHistory([{ id: 'a', references: ['INV-01'], sequences: [] }, { id: 'b', references: ['inv-1'], sequences: [] }], [], review))
  assert.throws(() => reviewHistory([{ id: 'a', references: ['ambiguous'], sequences: [] }], [], review))
  assert.throws(() => reviewHistory([{ id: 'a', references: [], sequences: [-1] }], [], review))
})
test('owners cannot initialize; absent counter prevents numbered creation', async () => {
  await removeCounter(A)
  await assertFails(setDoc(ref(a, A, 'invoiceCounters', 'main'), { ...meta(A), initializationVersion: 1, baselineSequence: 0, lastSequence: 0, lastInvoiceId: null }))
  await assert.rejects(allocate(a, A, 'before-initialization'))
  assert.equal((await getDoc(ref(a, A, 'invoices', 'before-initialization'))).exists(), false)
})
test('trusted initialization inventories existing invoices and refuses overwrite', async () => {
 await removeCounter(A);await removeCounter(B)
  await env.withSecurityRulesDisabled(ctx => setDoc(ref(ctx.firestore(), A, 'invoices', 'historical'), { ...draft(A), historicalReference: 'OLD-000047' }))
  await assert.rejects(initialize(A))
  await initialize(A, [{ id: 'historical', references: ['OLD-000047'], sequences: [] }])
  await initialize(B)
  await assert.rejects(initialize(A, [{ id: 'historical', references: ['OLD-000047'], sequences: [] }]))
  assert.equal((await getDoc(ref(a, A, 'invoiceCounters', 'main'))).data().lastSequence, 47)
})
test('historical baseline, separate workspaces and atomic maximum-size allocation', async () => {
  assert.equal(await allocate(a, A, 'first', { count: 8, override: true }), 48)
  assert.equal(await allocate(b, B, 'first'), 1)
  assert.equal((await getDocs(collection(a, ...base(A), 'invoices', 'first', 'items'))).size, 8)
  assert.equal(await allocate(a, A, 'first'), 48)
  assert.equal((await getDoc(ref(a, A, 'invoiceCounters', 'main'))).data().lastSequence, 48)
})
test('genuinely concurrent creation retries and allocates unique consecutive numbers', async () => {
  await allocate(a,A,'first');const secondClient=identity(env,A)
  assert.notEqual(secondClient,a)
  assert.notEqual(secondClient.app.name,a.app.name)
  let arrived = 0, release, timer;const initialReads=[]
  const gate = new Promise((resolve,reject) => { release = resolve;timer=setTimeout(()=>reject(new Error('Concurrency barrier timed out')),15000);timer.unref() })
  const once = () => { let first = true; return async info => { if (!first) return; first = false;initialReads.push(info.observed.sequence); if (++arrived === 2){clearTimeout(timer);release()} await gate } }
  const settled = await Promise.allSettled([allocate(a, A, 'concurrent-a', { barrier: once() }), allocate(secondClient, A, 'concurrent-b', { barrier: once() })]);assert.equal(arrived,2);for(const result of settled)assert.equal(result.status,'fulfilled',result.reason?.message);const numbers=settled.map(r=>r.value)
  assert.deepEqual(numbers.sort((x, y) => x - y), [49, 50])
  assert.deepEqual(initialReads,[48,48])
})
test('invalid item rolls back header, snapshot and counter together', async () => {
  const before = (await getDoc(ref(a, A, 'invoiceCounters', 'main'))).data()
  await assert.rejects(allocate(a, A, 'invalid-item', { invalidItem: true }),/Invalid invoice item amount/)
  assert.equal((await getDoc(ref(a, A, 'invoices', 'invalid-item'))).exists(), false)
  assert.deepEqual((await getDoc(ref(a, A, 'invoiceCounters', 'main'))).data(), before)
})
test('counter reset, jump, decrease, baseline mutation, deletion and standalone increments denied', async () => {
  await seedFirst();await allocate(a,A,'second');await allocate(a,A,'third')
  const counter = ref(a, A, 'invoiceCounters', 'main'), current = (await getDoc(counter)).data()
  for (const patch of [{ lastSequence: 0 }, { lastSequence: 100 }, { lastSequence: 49 }, { baselineSequence: 0 }, { initializationVersion: 2 }, { ownerId: B }, { lastSequence: 51, lastInvoiceId: 'first' }, { admin: true }]) {
    await assertFails(updateDoc(counter, { ...patch, ...stamp(current.revision + 1) }))
  }
  await assertFails(deleteDoc(counter))
})
test('missing allocation, mismatched invoice ID and two-header allocation denied', async () => {
  await seedFirst();await allocate(a,A,'second');await allocate(a,A,'third')
  await assertFails(setDoc(ref(a, A, 'invoices', 'missing-counter'), { ...draft(A), numberPrefix: 'INV', numberSequence: 51 }))
  for (const mode of ['wrong-id', 'two-headers', 'wrong-sequence', 'wrong-prefix']) {
    const batch = writeBatch(a), counter = (await getDoc(ref(a, A, 'invoiceCounters', 'main'))).data()
    batch.set(ref(a, A, 'invoices', `attack-${mode}`), { ...draft(A), numberPrefix: mode === 'wrong-prefix' ? 'EVIL' : 'INV', numberSequence: mode === 'wrong-sequence' ? 52 : 51 })
    if (mode === 'two-headers') batch.set(ref(a, A, 'invoices', 'second-attack'), { ...draft(A), numberPrefix: 'INV', numberSequence: 51 })
    batch.update(ref(a, A, 'invoiceCounters', 'main'), { lastSequence: 51, lastInvoiceId: mode === 'wrong-id' ? 'nonexistent' : `attack-${mode}`, ...stamp(counter.revision + 1) })
    await assertFails(batch.commit())
  }
})
test('six manual labels leave payment records, canonical amounts and agency unchanged', async () => {
  await seedFirst()
  const agency = (await getDoc(ref(a, A, 'settings', 'agency'))).data()
  const original = (await getDoc(ref(a, A, 'invoices', 'first', 'configuration', 'snapshot'))).data()
  const items = (await getDocs(collection(a, ...base(A), 'invoices', 'first', 'items'))).docs.map(row => row.data())
  for (const manualStatus of ['draft', 'sent', 'pending', 'paid', 'overdue', 'cancelled']) await assertSucceeds(edit(a, A, 'first', { manualStatus }))
  await assertFails(edit(a, A, 'first', { manualStatus: 'verified-paid' }))
  await assertFails(edit(a, A, 'first', { paymentVerified: true }))
  assert.equal((await getDocs(collection(a, ...base(A), 'payments'))).size, 0)
  assert.deepEqual((await getDocs(collection(a, ...base(A), 'invoices', 'first', 'items'))).docs.map(row => { const {revision,updatedAt,invoiceRevision,...amounts}=row.data();return amounts }), items.map(row=>{const {revision,updatedAt,invoiceRevision,...amounts}=row;return amounts}))
  assert.deepEqual((await getDoc(ref(a, A, 'settings', 'agency'))).data(), agency)
  const after = (await getDoc(ref(a, A, 'invoices', 'first', 'configuration', 'snapshot'))).data()
  assert.equal(after.agencyJson, original.agencyJson); assert.equal(after.clientJson, original.clientJson); assert.equal(after.contentJson, original.contentJson)
})
test('number components immutable; prefix changes affect only future invoices', async () => {
  await seedFirst();await allocate(a,A,'second');await allocate(a,A,'third')
  for (const patch of [{ numberSequence: 1 }, { numberPrefix: 'NEW' }]) await assertFails(edit(a, A, 'first', patch))
  await updateDoc(ref(a, A, 'settings', 'invoice'), { invoicePrefix: 'NEW', ...stamp(2) })
  assert.equal(await allocate(a, A, 'new-prefix'), 51)
  assert.equal((await getDoc(ref(a, A, 'invoices', 'first'))).data().numberPrefix, 'INV')
  assert.equal((await getDoc(ref(a, A, 'invoices', 'new-prefix'))).data().numberPrefix, 'NEW')
})
test('override edits preserve original snapshots/profile; standalone or malformed writes denied', async () => {
  await seedFirst()
  const before = (await getDoc(ref(a, A, 'invoices', 'first', 'configuration', 'snapshot'))).data()
  const agency = (await getDoc(ref(a, A, 'settings', 'agency'))).data()
  await assertSucceeds(edit(a, A, 'first', {}, { ...details(), upiEnabled: true, upiId: 'owner@bank' }))
  for (const patch of [{ upiEnabled: true, upiId: 'invalid' }, { bankEnabled: true }, { otherEnabled: true }, { qr: 'x'.repeat(45001) }, { qr: 'https://example.test/qr' }, { admin: true }, { cashEnabled: 'true' }]) await assertFails(edit(a, A, 'first', {}, { ...details(), ...patch }))
  const override = ref(a, A, 'invoices', 'first', 'configuration', 'paymentOverride')
  await assertFails(updateDoc(override, { details: details(), ...stamp(3) }))
  await assertFails(deleteDoc(override))
  const after = (await getDoc(ref(a, A, 'invoices', 'first', 'configuration', 'snapshot'))).data()
  assert.equal(after.agencyJson, before.agencyJson); assert.equal(after.clientJson, before.clientJson)
  assert.deepEqual((await getDoc(ref(a, A, 'settings', 'agency'))).data(), agency)
  const batch = writeBatch(a)
  const h = (await getDoc(ref(a, A, 'invoices', 'first'))).data()
  batch.update(ref(a, A, 'invoices', 'first'), stamp(h.revision + 1))
  batch.update(ref(a, A, 'invoices', 'first', 'configuration', 'snapshot'), { agencyJson: '{}', ...stamp(after.revision + 1) })
  await assertFails(batch.commit())
})
test('legacy unnumbered invoices remain editable without automatic numbering; snapshots required for override', async () => {
  await env.withSecurityRulesDisabled(ctx => setDoc(ref(ctx.firestore(), A, 'invoices', 'legacy'), draft(A)))
  await assertSucceeds(updateDoc(ref(a, A, 'invoices', 'legacy'), { title: 'Legacy edit', manualStatus: 'pending', ...stamp(2) }))
  await assertFails(updateDoc(ref(a, A, 'invoices', 'legacy'), { numberPrefix: 'NEW', numberSequence: 52, ...stamp(3) }))
  const batch = writeBatch(a)
  batch.update(ref(a, A, 'invoices', 'legacy'), stamp(3))
  batch.set(ref(a, A, 'invoices', 'legacy', 'configuration', 'paymentOverride'), { ...meta(A), details: details() })
  await assertFails(batch.commit())
})
test('cross-user, anonymous, unverified, suspended, unknown/public/admin paths denied', async () => {
  await seedFirst()
  for (const db of [b, identity(env, A, { email_verified: false }), env.unauthenticatedContext().firestore()]) {
    for (const parts of [['invoiceCounters', 'main'], ['invoices', 'first'], ['invoices', 'first', 'configuration', 'snapshot'], ['invoices', 'first', 'configuration', 'paymentOverride'], ['invoices', 'first', 'items', 'line-0']]) {
      await assertFails(getDoc(ref(db, A, ...parts)))
      await assertFails(updateDoc(ref(db, A, ...parts), { ownerId: B, ...stamp(2) }))
    }
    await assertFails(getDocs(collection(db, ...base(A), 'invoices')))
  }
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'accountAccess', A), { userId: A, status: 'suspended' }))
  await assertFails(getDoc(ref(a, A, 'invoiceCounters', 'main')))
  await assertFails(allocate(a, A, 'suspended'))
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'accountAccess', A), { userId: A, status: 'active' }))
  for (const parts of [['publicLinks', 'x'], ['admins', A], ['workspaces', A, 'invoices', 'first', 'configuration', 'unknown']]) await assertFails(setDoc(doc(a, ...parts), { ownerId: A }))
  await assertFails(setDoc(doc(a, 'accountAccess', A), { userId: A, status: 'active', admin: true }))
})

test('stale transaction recovers with fresh reads and a stable request identity', async () => {
  const attempts=[], rival=identity(env,A)
  const result=await allocate(a,A,'stale',{requestId:'stable-request',hooks:{
    afterRead:async info=>{attempts.push({...info,observed:{...info.observed}});if(info.attempt===1)await allocate(rival,A,'rival')}
  }})
  assert.equal(result,49);assert.equal(attempts.length,2)
  assert.deepEqual(attempts.map(x=>x.observed.sequence),[47,48])
  assert.ok(attempts.every(x=>x.invoiceId==='stale'&&x.requestId==='stable-request'))
  const content=JSON.parse((await getDoc(ref(a,A,'invoices','stale','configuration','snapshot'))).data().contentJson)
  assert.equal(content._allocation.requestId,'stable-request')
})

test('permission failure with unchanged counter is never retried and leaves no partial records',async()=>{
  let attempts=0;const before=(await getDoc(ref(a,A,'invoiceCounters','main'))).data()
  await assert.rejects(allocate(a,A,'unchanged',{hooks:{afterRead:()=>attempts++,beforeCommit:()=>{throw Object.assign(new Error('Simulated permission response'),{code:'permission-denied'})}}}),e=>e.code==='allocation-not-retried')
  assert.equal(attempts,1);await noPartial(a,A,'unchanged')
  assert.deepEqual((await getDoc(ref(a,A,'invoiceCounters','main'))).data(),before)
})

test('genuine suspension during commit is not retried even when counter advanced',async()=>{
  let attempts=0;const rival=identity(env,A)
  await assert.rejects(allocate(a,A,'suspended-during-commit',{hooks:{afterRead:async()=>{
    attempts++;await allocate(rival,A,'legitimate-rival')
    await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'accountAccess',A),{userId:A,status:'suspended'}))
  }}}),e=>e.code==='allocation-recovery-denied')
  assert.equal(attempts,1)
  await env.withSecurityRulesDisabled(ctx=>noPartial(ctx.firestore(),A,'suspended-during-commit'))
})

test('malformed input, invalid references and foreign-owner attempts do not retry',async()=>{
  for(const mode of ['malformed','reference','foreign']){
    let attempts=0;const p=input(A)
    if(mode==='malformed')p.items[0].quantityMilli=-1
    if(mode==='reference')p.header.clientId='nonexistent-client'
    await assert.rejects(allocateCandidateInvoice(mode==='foreign'?b:a,A,'bad-'+mode,'req-'+mode,p,{afterRead:()=>attempts++}))
    assert.equal(attempts,0);await noPartial(a,A,'bad-'+mode)
  }
})

test('reference invalidated during commit is not retried despite counter advancement',async()=>{
  let attempts=0;const rival=identity(env,A)
  await assert.rejects(allocate(a,A,'removed-client',{hooks:{afterRead:async()=>{
    attempts++;await allocate(rival,A,'valid-rival')
    await env.withSecurityRulesDisabled(ctx=>deleteDoc(ref(ctx.firestore(),A,'clients','client')))
  }}}),e=>e.code==='allocation-recovery-denied'&&e.cause?.code==='invalid-allocation')
  assert.equal(attempts,1);await noPartial(a,A,'removed-client')
  assert.equal((await getDoc(ref(a,A,'invoiceCounters','main'))).data().lastSequence,48)
})

test('orphan snapshot is never reused as a new allocation',async()=>{
  await env.withSecurityRulesDisabled(ctx=>setDoc(ref(ctx.firestore(),A,'invoices','orphan','configuration','snapshot'),snapshot(A)))
  let attempts=0
  await assert.rejects(allocate(a,A,'orphan',{hooks:{afterRead:()=>attempts++}}),/orphan invoice snapshot/)
  assert.equal(attempts,0);assert.equal((await getDoc(ref(a,A,'invoices','orphan'))).exists(),false)
  assert.equal((await getDoc(ref(a,A,'invoiceCounters','main'))).data().lastSequence,47)
})

test('uncertain successful commit recognized only by matching allocation request ID',async()=>{
  let attempts=0,commits=0
  const result=await allocate(a,A,'uncertain',{requestId:'request-uncertain',hooks:{afterRead:()=>attempts++,afterCommit:()=>{commits++;throw Object.assign(new Error('Response lost after commit'),{code:'unavailable'})}}})
  assert.equal(result,48);assert.equal(attempts,1);assert.equal(commits,1)
  assert.equal(await allocate(a,A,'uncertain',{requestId:'request-uncertain'}),48)
  await assert.rejects(allocate(a,A,'uncertain',{requestId:'different-request'}),e=>e.code==='allocation-conflict')
  assert.equal((await getDoc(ref(a,A,'invoiceCounters','main'))).data().lastSequence,48)
})

test('uncertain commit recovery rejects a mismatched protected identity',async()=>{
  await assert.rejects(allocate(a,A,'mismatch-recovery',{hooks:{afterCommit:async()=>{
    // Simulate an inconsistent response/record; privileged fixture only, never allocator writes.
    await env.withSecurityRulesDisabled(ctx=>updateDoc(ref(ctx.firestore(),A,'invoices','mismatch-recovery'),{'allocation.requestId':'other-request'}))
    throw Object.assign(new Error('Uncertain response'),{code:'unavailable'})
  }}}),e=>e.code==='allocation-recovery-denied'&&e.cause?.code==='allocation-conflict')
})

test('bounded recovery exhaustion returns clear failure and leaves no partial invoice',async()=>{
  let attempts=0;const rival=identity(env,A)
  await assert.rejects(allocate(a,A,'exhaustion',{hooks:{afterRead:async info=>{attempts++;await allocate(rival,A,'winner-'+info.attempt)}}}),e=>e.code==='allocation-exhausted'&&e.message.includes('3 attempts'))
  assert.equal(attempts,MAX_ALLOCATION_ATTEMPTS);assert.equal((await getDoc(ref(a,A,'invoiceCounters','main'))).data().lastSequence,50)
  await noPartial(a,A,'exhaustion')
})

async function noPartial(db,uid,id){
  for(const parts of [['invoices',id],['invoices',id,'configuration','snapshot'],['invoices',id,'configuration','paymentOverride']])assert.equal((await getDoc(ref(db,uid,...parts))).exists(),false)
  assert.equal((await getDocs(collection(db,...base(uid),'invoices',id,'items'))).size,0)
}

test('server-rejected atomic commit rolls back header, snapshot, items, override and counter',async()=>{
  const id='rejected-commit',counter=(await getDoc(ref(a,A,'invoiceCounters','main'))).data()
  const writes=await plannedAllocation(a,A,id,'request-'+id,input(A,2,true))
  writes.find(([,path])=>path.includes('/items/'))[2].quantityMilli=-1
  await assertFails(commitPlanned(a,writes));await noPartial(a,A,id)
  assert.equal((await getDoc(ref(a,A,'invoiceAllocations','request-'+id))).exists(),false)
  assert.deepEqual((await getDoc(ref(a,A,'invoiceCounters','main'))).data(),counter)
})

test('counter mutation denials use otherwise coordinated valid allocations',async()=>{
  const counter=(await getDoc(ref(a,A,'invoiceCounters','main'))).data()
  for(const [name,patch]of Object.entries({jump:{lastSequence:50},decrease:{lastSequence:46},baseline:{baselineSequence:0},version:{initializationVersion:2},owner:{ownerId:B},revision:{revision:7},extra:{admin:true}})){
    const id='counter-denial-'+name,sequence=patch.lastSequence??48
    const writes=await plannedAllocation(a,A,id,'request-'+id,input(A))
    for(const [,path,data]of writes){
      if(path.endsWith('/invoices/'+id)){data.numberSequence=sequence;data.allocation.sequence=sequence}
      if(path.includes('/invoiceAllocations/'))data.identity.sequence=sequence
      if(path.endsWith('/invoiceCounters/main'))Object.assign(data,patch)
    }
    await assertFails(commitPlanned(a,writes));await noPartial(a,A,id)
    assert.deepEqual((await getDoc(ref(a,A,'invoiceCounters','main'))).data(),counter)
  }
})

test('maximum-size allocation also succeeds with an explicit active-account override',async()=>{
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'accountAccess',A),{userId:A,status:'active'}))
  assert.equal(await allocate(a,A,'maximum-active',{count:8,override:true}),48)
  assert.equal((await getDocs(collection(a,...base(A),'invoices','maximum-active','items'))).size,8)
})
