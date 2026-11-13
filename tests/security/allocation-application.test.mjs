import { before, beforeEach, afterEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { initializeApp, deleteApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, GoogleAuthProvider, signInWithCredential, signOut } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, terminate, Timestamp } from 'firebase/firestore'
import { PROJECT, requireEmulators, client, project, settingsFactories } from './helpers.mjs'
import { completeOnboarding } from '../../src/features/auth/workspace-service.ts'
import { initializeEmulatorCounter } from '../../scripts/admin/invoice-counter-emulator.mjs'
import { createInvoiceAllocationStore } from '../../src/features/workspace/invoices/allocation-store.ts'
import { allocateInvoice } from '../../src/features/workspace/invoices/allocation.ts'

let env, auth, db, app, uid, testIndex=0
function payload() { return { header:{clientId:'client',projectId:'project',title:'Application allocation',state:'draft',issueAt:Timestamp.fromMillis(0),dueAt:null,terms:'',notes:'',manualStatus:'draft'},snapshot:{agencyJson:'{}',clientJson:'{}',contentJson:'{}'},items:[{id:'line',description:'Service',quantityMilli:1000,unitPriceMinor:100,taxRateBps:0,discountBps:0}] } }
before(async()=>{
  requireEmulators()
  env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8180,rules:await readFile(process.env.GROWTHMARK_INVOICE_RULES_FILE === 'firestore.release.rules' ? 'firestore.release.rules' : 'firestore.invoice-workflow.candidate.rules','utf8')}})
})
beforeEach(async()=>{
  await env.clearFirestore()
  const name='extracted-real-auth-'+(++testIndex)
  app=initializeApp({projectId:PROJECT,apiKey:'demo-emulator-only',authDomain:'localhost'},name)
  auth=getAuth(app);db=getFirestore(app);connectAuthEmulator(auth,'http://127.0.0.1:9199',{disableWarnings:true});connectFirestoreEmulator(db,'127.0.0.1',8180)
  await signInWithCredential(auth,GoogleAuthProvider.credential(JSON.stringify({sub:name,email:`${name}@example.test`,email_verified:true})))
  uid=auth.currentUser.uid;await completeOnboarding(auth,db,{ownerName:'Owner',businessName:'Application test'})
  await setDoc(doc(db,'workspaces',uid,'clients','client'),client(uid));await setDoc(doc(db,'workspaces',uid,'projects','project'),project(uid));await setDoc(doc(db,'workspaces',uid,'settings','invoice'),settingsFactories.invoice(uid))
  await env.withSecurityRulesDisabled(ctx=>initializeEmulatorCounter(ctx.firestore(),uid,[],[],{complete:true,reviewer:'Test only'}))
})
afterEach(async()=>{if(db)await terminate(db);if(app)await deleteApp(app)})
after(async()=>{await env?.cleanup()})

test('application store uses real Auth emulator identity and allocates atomically',async()=>{
  const store=await createInvoiceAllocationStore(auth,db)
  assert.equal(store.ownerId,uid)
  assert.ok(Object.isFrozen(store));assert.throws(()=>{store.ownerId='foreign-owner'},TypeError)
  const result=await allocateInvoice(store,'application-invoice','application-request',payload())
  assert.deepEqual(result,{invoiceId:'application-invoice',requestId:'application-request',sequence:1,prefix:'INV'})
  assert.equal((await getDoc(doc(db,'workspaces',uid,'invoiceCounters','main'))).data().lastSequence,1)
  assert.equal((await getDoc(doc(db,'workspaces',uid,'invoices','application-invoice','items','line'))).exists(),true)
})
test('application store recognizes committed request and rejects another request ID',async()=>{
  const store=await createInvoiceAllocationStore(auth,db)
  await allocateInvoice(store,'application-invoice','application-request',payload())
  assert.equal((await allocateInvoice(store,'application-invoice','application-request',payload())).sequence,1)
  await assert.rejects(allocateInvoice(store,'application-invoice','different-request',payload()),e=>e.code==='allocation-conflict')
})
test('application store refuses suspended account and cannot create a counter',async()=>{
  const store=await createInvoiceAllocationStore(auth,db)
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'accountAccess',uid),{userId:uid,status:'suspended'}))
  await assert.rejects(allocateInvoice(store,'suspended-invoice','suspended-request',payload()))
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'accountAccess',uid),{userId:uid,status:'active'}))
  // There is no counter-initialization API on the application store/allocator.
  assert.equal(Object.hasOwn(store,'initializeCounter'),false)
  assert.equal((await getDoc(doc(db,'workspaces',uid,'invoiceCounters','main'))).data().lastSequence,0)
})
test('application store rejects mismatched Firebase apps and unverified identities',async()=>{
  const other=initializeApp({projectId:PROJECT,apiKey:'demo-emulator-only'},'different-allocation-app')
  try {
    const otherAuth=getAuth(other);connectAuthEmulator(otherAuth,'http://127.0.0.1:9199',{disableWarnings:true})
    await assert.rejects(createInvoiceAllocationStore(otherAuth,db),/same selected Firebase app/)
  } finally {await deleteApp(other)}
  const fake={app:auth.app,emulatorConfig:auth.emulatorConfig,currentUser:{uid,email:'unverified@example.test',emailVerified:false}}
  await assert.rejects(createInvoiceAllocationStore(fake,db),/verified workspace owner/)
})
test('application store captured before logout refuses later reads and allocations',async()=>{
  const store=await createInvoiceAllocationStore(auth,db)
  await signOut(auth)
  await assert.rejects(store.read(`workspaces/${uid}`),/verified workspace owner/)
  await assert.rejects(allocateInvoice(store,'after-logout','logout-request',payload()),/verified workspace owner/)
})

test('application store cannot be reused after switching to another verified account',async()=>{
  const store=await createInvoiceAllocationStore(auth,db)
  await signInWithCredential(auth,GoogleAuthProvider.credential(JSON.stringify({sub:'switched-'+testIndex,email:`switched-${testIndex}@example.test`,email_verified:true})))
  await assert.rejects(store.read(`workspaces/${uid}`),/session changed/)
  await assert.rejects(allocateInvoice(store,'after-switch','switch-request',payload()),/session changed/)
})
