import { before, beforeEach, afterEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { initializeApp, deleteApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, GoogleAuthProvider, signInWithCredential } from 'firebase/auth'
import { collection, doc, getDoc, getDocs, getFirestore, connectFirestoreEmulator, setDoc, updateDoc, deleteDoc, terminate } from 'firebase/firestore'
import { PROJECT, requireEmulators, client, project, settingsFactories } from './helpers.mjs'
import { initializeEmulatorCounter } from '../../scripts/admin/invoice-counter-emulator.mjs'
import { seedLegacyInvoice } from './helpers/legacy-invoice-fixture.mjs'
import { completeOnboarding } from '../../src/features/auth/workspace-service.ts'
import { createNumberedInvoice, saveAdvancedDraft, loadInvoiceSnapshot, saveAgency } from '../../src/features/workspace/invoices/service.ts'
import { saveRecord } from '../../src/features/workspace/record-service.ts'
import { inputValues, entityFields } from '../../src/features/workspace/schema.ts'
import { defaultAgency, newLine, calculateInvoice } from '../../src/features/workspace/invoices/model.ts'

let env, auth, db, app, uid, name, index=0, extras=[]
const path=(...parts)=>doc(db,'workspaces',uid,...parts)
const request=id=>({invoiceId:id,requestId:'request-'+id,projectId:'project'})
function fixture(){return{version:1,agency:{...defaultAgency(),name:'Original agency',upiEnabled:'true',upiId:'original@bank',upiHolder:'Original holder',instructions:'Original payment instructions'},client:{name:'Client',company:'',contact:'',email:'',phone:'',whatsapp:'',address:'',gstin:''},title:'Services',date:'2026-01-01',due:'2026-01-15',currency:'INR',priceMode:'exclusive',gstMode:'split',gstEnabled:true,discountKind:'percent',discount:'10',charges:'5',notes:'Original notes',terms:'Original terms',methods:['upi'],lines:[{...newLine('one'),name:'Consulting',rate:'100',quantity:'2',gst:'18'}]}}
async function create(id,draft=fixture(),options=request(id),clientId='client'){return createNumberedInvoice(auth,db,draft,clientId,options)}
async function noPartial(id){
  for(const parts of [['invoices',id],['invoices',id,'configuration','snapshot'],['invoices',id,'configuration','paymentOverride']])assert.equal((await getDoc(path(...parts))).exists(),false)
  assert.equal((await getDocs(collection(db,'workspaces',uid,'invoices',id,'items'))).size,0)
}
async function counter(){return(await getDoc(path('invoiceCounters','main'))).data()}
async function localApp(appName){
  const a=initializeApp({projectId:PROJECT,apiKey:'demo-emulator-only',authDomain:'localhost'},appName),au=getAuth(a),d=getFirestore(a)
  connectAuthEmulator(au,'http://127.0.0.1:9199',{disableWarnings:true});connectFirestoreEmulator(d,'127.0.0.1',8180)
  await signInWithCredential(au,GoogleAuthProvider.credential(JSON.stringify({sub:name,email:`${name}@example.test`,email_verified:true})))
  return{app:a,auth:au,db:d}
}
before(async()=>{
  requireEmulators()
  env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8180,rules:await readFile(process.env.GROWTHMARK_INVOICE_RULES_FILE === 'firestore.release.rules' ? 'firestore.release.rules' : 'firestore.invoice-workflow.candidate.rules','utf8')}})
})
beforeEach(async()=>{
  await env.clearFirestore();name='service-integration-'+(++index)
  const local=await localApp(name);app=local.app;auth=local.auth;db=local.db;uid=auth.currentUser.uid
  await completeOnboarding(auth,db,{ownerName:'Owner',businessName:'Original agency'})
  await setDoc(path('clients','client'),client(uid));await setDoc(path('projects','project'),project(uid));await setDoc(path('settings','invoice'),settingsFactories.invoice(uid))
  await saveAgency(auth,db,fixture().agency)
  await env.withSecurityRulesDisabled(ctx=>initializeEmulatorCounter(ctx.firestore(),uid,[],[{id:'external-history',references:['OLD-47'],sequences:[]}],{complete:true,reviewer:'Test fixture only'}))
})
afterEach(async()=>{for(const local of extras){await terminate(local.db);await deleteApp(local.app)}extras=[];if(db)await terminate(db);if(app)await deleteApp(app)})
after(async()=>env?.cleanup())

test('service: creation allocates one number and commits compatible snapshot and canonical items',async()=>{
  const draft=fixture(),agency=(await getDoc(path('settings','agency'))).data()
  const result=await create('new-invoice',draft)
  assert.deepEqual(result,{invoiceId:'new-invoice',requestId:'request-new-invoice',sequence:48,prefix:'INV'})
  const loaded=await loadInvoiceSnapshot(auth,db,'new-invoice'),head=(await getDoc(path('invoices','new-invoice'))).data()
  assert.deepEqual(loaded.draft,draft);assert.deepEqual(loaded.allocation,{version:1,invoiceId:'new-invoice',requestId:'request-new-invoice'})
  assert.equal(head.projectId,'project');assert.equal(head.ownerId,uid);assert.equal(head.workspaceId,uid);assert.equal(head.state,'draft');assert.equal(head.manualStatus,'draft')
  const items=await getDocs(collection(db,'workspaces',uid,'invoices','new-invoice','items'))
  assert.equal(items.size,2);assert.equal(items.docs.reduce((sum,row)=>sum+row.data().unitPriceMinor,0),calculateInvoice(draft).total)
  assert.equal((await counter()).lastSequence,48);assert.deepEqual((await getDoc(path('settings','agency'))).data(),agency)
})
test('service: uncertain caller response retries same IDs without duplicate allocation',async()=>{
  // The caller deliberately discards the first result, as after a lost response.
  await create('uncertain');const before=await counter(),original=(await getDoc(path('invoices','uncertain','configuration','snapshot'))).data()
  assert.equal((await create('uncertain')).sequence,48)
  assert.deepEqual(await counter(),before);assert.deepEqual((await getDoc(path('invoices','uncertain','configuration','snapshot'))).data(),original)
  assert.equal((await getDocs(collection(db,'workspaces',uid,'invoices'))).size,1)
  await assert.rejects(create('uncertain',fixture(),{...request('uncertain'),requestId:'different-request'}),e=>e.code==='allocation-conflict')
  assert.deepEqual(await counter(),before)
})
test('service: candidate edits never touch counter, number, original snapshots or payment override',async()=>{
  await create('edit');const before=await counter(),loaded=await loadInvoiceSnapshot(auth,db,'edit'),original=(await getDoc(path('invoices','edit','configuration','snapshot'))).data()
  const override={schemaVersion:1,workspaceId:uid,ownerId:uid,revision:1,createdAt:original.createdAt,updatedAt:original.updatedAt,details:{upiEnabled:true,upiId:'invoice@bank',upiHolder:'Invoice holder',qr:'',bankEnabled:false,bankHolder:'',bankName:'',accountNumber:'',ifsc:'',branch:'',cashEnabled:false,otherEnabled:false,otherMethod:'',instructions:'Private invoice override'}}
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'workspaces',uid,'invoices','edit','configuration','paymentOverride'),override))
  loaded.draft.notes='Edited';await saveAdvancedDraft(auth,db,loaded.draft,'client','edit',1,1)
  assert.deepEqual(await counter(),before)
  const after=(await getDoc(path('invoices','edit','configuration','snapshot'))).data(),head=(await getDoc(path('invoices','edit'))).data()
  assert.equal(after.agencyJson,original.agencyJson);assert.equal(after.clientJson,original.clientJson);assert.deepEqual(JSON.parse(after.contentJson)._allocation,loaded.allocation)
  assert.equal(head.numberSequence,48);assert.equal(head.numberPrefix,'INV');assert.deepEqual((await getDoc(path('invoices','edit','configuration','paymentOverride'))).data(),override)
})
test('service: edit succeeds without any counter, proving it does not call the allocator',async()=>{
  await create('edit-no-counter');const loaded=await loadInvoiceSnapshot(auth,db,'edit-no-counter')
  await env.withSecurityRulesDisabled(ctx=>deleteDoc(doc(ctx.firestore(),'workspaces',uid,'invoiceCounters','main')))
  loaded.draft.notes='Still editable';await saveAdvancedDraft(auth,db,loaded.draft,'client','edit-no-counter',1,1)
  assert.equal((await getDoc(path('invoiceCounters','main'))).exists(),false)
  assert.deepEqual((await loadInvoiceSnapshot(auth,db,'edit-no-counter')).allocation,loaded.allocation)
})
test('service: legacy edit remains unnumbered and does not require or create a counter',async()=>{
  await seedLegacyInvoice(env,uid,fixture(),'client','legacy')
  await env.withSecurityRulesDisabled(ctx=>deleteDoc(doc(ctx.firestore(),'workspaces',uid,'invoiceCounters','main')))
  const loaded=await loadInvoiceSnapshot(auth,db,'legacy');loaded.draft.notes='Legacy edit'
  await saveAdvancedDraft(auth,db,loaded.draft,'client','legacy',1,1)
  const head=(await getDoc(path('invoices','legacy'))).data()
  assert.equal(head.numberSequence,undefined);assert.equal((await loadInvoiceSnapshot(auth,db,'legacy')).allocation,undefined);assert.equal((await getDoc(path('invoiceCounters','main'))).exists(),false)
})
test('service: missing or uninitialized/invalid counter fails clearly with no partial invoice',async()=>{
  const original=await counter()
  for(const [id,value]of [['missing',null],['uninitialized',{...original,initializationVersion:undefined}],['invalid',{...original,lastSequence:-1}]]){
    await env.withSecurityRulesDisabled(async ctx=>{
      const ref=doc(ctx.firestore(),'workspaces',uid,'invoiceCounters','main')
      if(!value)await deleteDoc(ref)
      else{const copy={...value};if(copy.initializationVersion===undefined)delete copy.initializationVersion;await setDoc(ref,copy)}
    })
    await assert.rejects(create(id),/Counter requires trusted initialization or review/);await noPartial(id)
    if(value){const expected={...value};if(expected.initializationVersion===undefined)delete expected.initializationVersion;assert.deepEqual(await counter(),expected)}
    else assert.equal((await getDoc(path('invoiceCounters','main'))).exists(),false)
  }
})
test('service: invalid currency, client, project, IDs, extra owner fields and items fail before allocation',async()=>{
  const before=await counter()
  for(const mode of ['currency','client','project','ids','ownership','items','allocation']){
    const draft=fixture();let options=request('bad-'+mode),clientId='client'
    if(mode==='currency')draft.currency='USD'
    if(mode==='client')clientId='missing-client'
    if(mode==='project')options.projectId='missing-project'
    if(mode==='ids')options.requestId='bad/id'
    if(mode==='ownership')options.ownerId='other-owner'
    if(mode==='items')draft.lines[0].quantity='-1'
    if(mode==='allocation')draft._allocation={version:1,invoiceId:'injected',requestId:'injected'}
    await assert.rejects(create('bad-'+mode,draft,options,clientId));await noPartial('bad-'+mode);assert.deepEqual(await counter(),before)
  }
})
test('service: project must belong to selected client within the authenticated workspace',async()=>{
  await setDoc(path('clients','second-client'),{...client(uid),name:'Second client'})
  await setDoc(path('projects','different-client'),{...project(uid),clientId:'second-client'})
  await assert.rejects(create('wrong-project',fixture(),{...request('wrong-project'),projectId:'different-client'}),/Invalid client or project/)
  await noPartial('wrong-project');assert.equal((await counter()).lastSequence,47)
})
test('service: old save and generic module cannot bypass numbered creation under candidate rules',async()=>{
  await assert.rejects(saveAdvancedDraft(auth,db,fixture(),'client','old-route'),/numbered creation service/)
  await assert.rejects(saveAdvancedDraft(auth,db,fixture(),'client','absent-edit',1,1),/does not exist/)
  await assert.rejects(saveAdvancedDraft(auth,db,fixture(),'client'),/numbered creation service/)
  const fields={...inputValues(entityFields.invoices),clientId:'client',title:'Bypass',issueAt:'2026-01-01'}
  await assert.rejects(saveRecord(auth,db,'invoices',fields,'generic-bypass'),/numbered invoice service/)
  for(const id of ['old-route','absent-edit','generic-bypass'])await noPartial(id)
  assert.equal((await counter()).lastSequence,47)
})
test('service: maximum-sized invoice allocates atomically and retains exact calculation totals',async()=>{
  const draft=fixture();draft.lines=Array.from({length:7},(_,i)=>({...draft.lines[0],id:'line-'+i}));await create('maximum',draft)
  const items=await getDocs(collection(db,'workspaces',uid,'invoices','maximum','items'))
  assert.equal(items.size,8);assert.equal(items.docs.reduce((sum,row)=>sum+row.data().unitPriceMinor,0),calculateInvoice(draft).total)
})
test('service: independent clients create consecutive numbers and every operation is awaited',async()=>{
  const second=await localApp(name+'-second');extras.push(second)
  const settled=await Promise.allSettled([create('parallel-a'),createNumberedInvoice(second.auth,second.db,fixture(),'client',request('parallel-b'))])
  for(const result of settled)assert.equal(result.status,'fulfilled',result.reason?.message)
  assert.deepEqual(settled.map(result=>result.value.sequence).sort((a,b)=>a-b),[48,49]);assert.equal((await counter()).lastSequence,49)
})
