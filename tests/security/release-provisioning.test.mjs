import {before,beforeEach,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing'
import {doc,setDoc,getDoc,updateDoc,deleteDoc,serverTimestamp} from 'firebase/firestore'
import {PROJECT,requireEmulators,identity,bootstrap,client,draft,settingsFactories,meta} from './helpers.mjs'
import {firestoreRest} from '../../server/firestore-rest.mjs'
import {provisionNewWorkspace} from '../../server/workspace-provisioning.mjs'
import {inventoryWorkspace,provisionExistingWorkspace} from '../../server/provision-existing.mjs'
import {allocateInvoice} from '../../src/features/workspace/invoices/allocation.ts'
import {createInvoiceAllocationStore} from '../../src/features/workspace/invoices/allocation-store.ts'
import {mockAllocationAuth} from './helpers/extracted-allocation.mjs'
let env,store,uid,a,index=0
const p=(...parts)=>doc(a,'workspaces',uid,...parts)
const fresh=()=>({uid,email:uid+'@example.test',emailVerified:true,createdAt:Date.now()})
const names={ownerName:'Release test owner',businessName:'Release test business'}
async function legacy(reference='OLD-000047'){
  await bootstrap(a,uid);await setDoc(p('clients','client'),client(uid));await setDoc(p('settings','invoice'),settingsFactories.invoice(uid))
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'workspaces',uid,'invoices','historical'),{...draft(uid),projectId:null,numberPrefix:reference.slice(0,reference.lastIndexOf('-')),numberSequence:Number(reference.slice(reference.lastIndexOf('-')+1))}))
}
const review=report=>({...report,complete:true,reviewer:'Isolated test reviewer',externalReferences:[]})
before(async()=>{requireEmulators();env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8180,rules:await readFile('firestore.release.rules','utf8')}});store=firestoreRest({projectId:PROJECT,accessToken:'owner',baseUrl:'http://127.0.0.1:8180/v1',fetcher:async(url,init)=>{if(process.env.DEBUG_PROVISION_TRACE)console.log('TEST REST',init.method,new URL(url).pathname);const response=await fetch(url,init);if(process.env.DEBUG_PROVISION_TRACE)console.log('TEST REST status',response.status);return response}})})
beforeEach(async()=>{await env.clearFirestore();uid='release-owner-'+(++index);a=identity(env,uid)})
after(async()=>env?.cleanup())

test('trusted new signup atomically creates private profile, workspace, business defaults and zero counter',async()=>{
  assert.equal((await provisionNewWorkspace(store,fresh(),names,{newAccountsAfter:0})).status,'ready')
  const counter=(await getDoc(p('invoiceCounters','main'))).data();assert.equal(counter.lastSequence,0);assert.equal(counter.ownerId,uid)
  assert.equal((await getDoc(p('settings','business'))).data().name,names.businessName)
  assert.equal((await getDoc(p('settings','invoice'))).data().invoicePrefix,'RTB-INV')
  assert.equal((await getDoc(doc(a,'users',uid))).data().userId,uid)
  const other=identity(env,'other-owner');await assertFails(getDoc(doc(other,'workspaces',uid,'invoiceCounters','main')))
  await assertFails(setDoc(p('invoiceCounters','another'),{...meta(uid),lastSequence:0}))
})
test('new signup retries do not overwrite existing names or reset counters',async()=>{
  await provisionNewWorkspace(store,fresh(),names,{newAccountsAfter:0})
  const before=await store.get('workspaces/'+uid+'/invoiceCounters/main')
  assert.equal((await provisionNewWorkspace(store,fresh(),{...names,businessName:'Do not overwrite'},{newAccountsAfter:0})).status,'ready')
  assert.deepEqual(await store.get('workspaces/'+uid+'/invoiceCounters/main'),before)
  assert.equal((await store.get('workspaces/'+uid)).data.name,names.businessName)
})
test('simultaneous signup initialization never produces partial or duplicate workspaces',async()=>{
  const results=await Promise.allSettled([provisionNewWorkspace(store,fresh(),names,{newAccountsAfter:0}),provisionNewWorkspace(store,fresh(),names,{newAccountsAfter:0})])
  assert.ok(results.some(r=>r.status==='fulfilled'))
  assert.equal((await provisionNewWorkspace(store,fresh(),names,{newAccountsAfter:0})).status,'ready')
  assert.equal((await store.get('workspaces/'+uid+'/invoiceCounters/main')).data.lastSequence,0)
  assert.equal((await store.get('users/'+uid)).exists,true)
})
test('pre-release accounts, missing cutoff, unverified users and supplied owner IDs cannot initialize counters',async()=>{
  for(const [user,input,policy]of [[{...fresh(),createdAt:0},names,{newAccountsAfter:1}],[fresh(),names,{}],[{...fresh(),emailVerified:false},names,{newAccountsAfter:0}],[fresh(),{...names,ownerId:'foreign'},{newAccountsAfter:0}]])await assert.rejects(provisionNewWorkspace(store,user,input,policy))
  assert.equal((await store.get('workspaces/'+uid)).exists,false)
})
test('existing workspace without counter is inventory-required, never automatically reset to zero',async()=>{
  await legacy();const before=await store.get('workspaces/'+uid)
  assert.equal((await provisionNewWorkspace(store,fresh(),names,{newAccountsAfter:0})).status,'inventory-required')
  assert.deepEqual(await store.get('workspaces/'+uid),before);assert.equal((await store.get('workspaces/'+uid+'/invoiceCounters/main')).exists,false)
})
test('orphan business history blocks apparently new workspace initialization',async()=>{
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'workspaces',uid,'invoices','orphan'),draft(uid)))
  await assert.rejects(provisionNewWorkspace(store,fresh(),names,{newAccountsAfter:0}),/history/)
  assert.equal((await store.get('workspaces/'+uid)).exists,false)
})
test('reviewed historical inventory initializes above historical numbers and preserves all records',async()=>{
  await legacy();const before=await store.get('workspaces/'+uid+'/invoices/historical'),plan=await inventoryWorkspace(store,uid)
  assert.equal(plan.baseline,47)
  const result=await provisionExistingWorkspace(store,uid,review(plan));assert.equal(result.baseline,47)
  assert.deepEqual(await store.get('workspaces/'+uid+'/invoices/historical'),before)
  assert.equal((await store.get('accountAccess/'+uid)).exists,false)
  const base=await createInvoiceAllocationStore(mockAllocationAuth(a,uid),a)
  const result2=await allocateInvoice(base,'new-invoice','new-request',{header:{clientId:'client',projectId:null,title:'Service',state:'draft',issueAt:draft(uid).issueAt,dueAt:null,terms:'',notes:''},snapshot:{agencyJson:'{}',clientJson:'{}',contentJson:'{}'},items:[{id:'line',description:'Service',quantityMilli:1000,unitPriceMinor:100,taxRateBps:0,discountBps:0}]})
  assert.equal(result2.sequence,48)
  await assert.rejects(provisionExistingWorkspace(store,uid,review(plan)),/already exists/)
})
test('external reviewed references contribute to baseline and missing attestation is denied',async()=>{
  await legacy();const externalReferences=[{id:'external-document',reference:'OTHER-00101'}],plan=await inventoryWorkspace(store,uid,externalReferences)
  assert.equal(plan.baseline,101)
  await assert.rejects(provisionExistingWorkspace(store,uid,{...review(plan),externalReferences,complete:false}),/signed-off/)
  await provisionExistingWorkspace(store,uid,{...review(plan),externalReferences})
  assert.equal((await getDoc(p('invoiceCounters','main'))).data().lastSequence,101)
})
test('changed inventory invalidates review and safely restores the original access state',async()=>{
  await legacy();const plan=await inventoryWorkspace(store,uid)
  await updateDoc(p('invoices','historical'),{title:'Changed since review',revision:2,updatedAt:serverTimestamp()})
  await assert.rejects(provisionExistingWorkspace(store,uid,review(plan)),/changed since review/)
  assert.equal((await store.get('accountAccess/'+uid)).exists,false);assert.equal((await store.get('workspaces/'+uid+'/invoiceCounters/main')).exists,false)
  assert.equal((await getDoc(p('clients','client'))).exists(),true)
})
test('duplicate or ambiguous historical references stop inventory without writes',async()=>{
  await legacy();await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'workspaces',uid,'invoices','duplicate'),{...draft(uid),numberPrefix:'old',numberSequence:47}))
  await assert.rejects(inventoryWorkspace(store,uid),/Duplicate/)
  await env.withSecurityRulesDisabled(ctx=>deleteDoc(doc(ctx.firestore(),'workspaces',uid,'invoices','duplicate')))
  await env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),'workspaces',uid,'invoices','historical'),{invoiceNumber:'2025 / invoice 42'}))
  await assert.rejects(inventoryWorkspace(store,uid),/Ambiguous/)
  assert.equal((await store.get('accountAccess/'+uid)).exists,false)
})
test('suspended accounts cannot be provisioned or accidentally reactivated',async()=>{
  await legacy();const plan=await inventoryWorkspace(store,uid)
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'accountAccess',uid),{userId:uid,status:'suspended',reason:'Original suspension'}))
  await assert.rejects(provisionExistingWorkspace(store,uid,review(plan)),/Suspended/)
  await assert.rejects(provisionNewWorkspace(store,fresh(),names,{newAccountsAfter:0}),/access/)
  assert.equal((await store.get('accountAccess/'+uid)).data.reason,'Original suspension')
})
test('inventory freeze blocks normal business writes and restores exact original access metadata',async()=>{
  await legacy();await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'accountAccess',uid),{userId:uid,status:'active',note:'Preserve this'}))
  const original=await store.get('accountAccess/'+uid),plan=await inventoryWorkspace(store,uid);let blocked=false
  const adapter={...store,list:async(...args)=>{if(!blocked){await assertFails(updateDoc(p('clients','client'),{name:'Must fail',revision:2,updatedAt:serverTimestamp()}));blocked=true}return store.list(...args)}}
  await provisionExistingWorkspace(adapter,uid,review(plan));assert.equal(blocked,true)
  assert.deepEqual((await store.get('accountAccess/'+uid)).data,original.data)
})
test('concurrent trusted access-policy change is never overwritten or reactivated',async()=>{
  await legacy();const plan=await inventoryWorkspace(store,uid);let changed=false
  const adapter={...store,list:async(...args)=>{if(!changed){const lock=await store.get('accountAccess/'+uid);await store.commit([{path:'accountAccess/'+uid,data:{...lock.data,reason:'New admin decision'},updateTime:lock.updateTime}]);changed=true}return store.list(...args)}}
  await assert.rejects(provisionExistingWorkspace(adapter,uid,review(plan)),/lock/)
  assert.equal((await store.get('accountAccess/'+uid)).data.reason,'New admin decision');assert.equal((await store.get('accountAccess/'+uid)).data.status,'suspended')
  assert.equal((await store.get('workspaces/'+uid+'/invoiceCounters/main')).exists,false)
})
test('reviewed existing workspace without prefix receives a default without overwriting other settings',async()=>{
  await legacy();await env.withSecurityRulesDisabled(ctx=>deleteDoc(doc(ctx.firestore(),'workspaces',uid,'settings','invoice')))
  const plan=await inventoryWorkspace(store,uid);await provisionExistingWorkspace(store,uid,review(plan))
  assert.equal((await store.get('workspaces/'+uid+'/settings/invoice')).data.invoicePrefix,plan.proposedPrefix)
  assert.equal((await store.get('workspaces/'+uid+'/invoiceCounters/main')).data.lastSequence,47)
})
test('existing counter below history is reported and never silently repaired',async()=>{
  await legacy();await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'workspaces',uid,'invoiceCounters','main'),{...meta(uid),initializationVersion:1,baselineSequence:0,lastSequence:0,lastInvoiceId:null}))
  await assert.rejects(inventoryWorkspace(store,uid),/inconsistent with history/)
  assert.equal((await getDoc(p('invoiceCounters','main'))).data().lastSequence,0)
})
test('unrecognized historical schemas require review rather than an assumed zero baseline',async()=>{
  await legacy();await env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),'workspaces',uid,'invoices','historical'),{oldInvoiceData:{number:'Hidden-99'}}))
  await assert.rejects(inventoryWorkspace(store,uid),/Unrecognized historical invoice schema/)
  assert.equal((await store.get('workspaces/'+uid+'/invoiceCounters/main')).exists,false)
})
test('new workspace commit verifies suspension changes atomically and leaves no partial records',async()=>{
  let interrupted=false
  const adapter={...store,commit:async(writes,...args)=>{if(!interrupted){await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'accountAccess',uid),{userId:uid,status:'suspended'}));interrupted=true}return store.commit(writes,...args)}}
  await assert.rejects(provisionNewWorkspace(adapter,fresh(),names,{newAccountsAfter:0}))
  for(const path of ['users/'+uid,'workspaces/'+uid,'workspaces/'+uid+'/invoiceCounters/main'])assert.equal((await store.get(path)).exists,false)
  assert.equal((await store.get('accountAccess/'+uid)).data.status,'suspended')
})
