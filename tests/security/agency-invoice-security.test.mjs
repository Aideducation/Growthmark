import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { initializeApp, deleteApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, GoogleAuthProvider, signInWithCredential } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, collection, setDoc, updateDoc, serverTimestamp, terminate, writeBatch } from 'firebase/firestore'
import { PROJECT, requireEmulators, meta, identity, A } from './helpers.mjs'
import { completeOnboarding } from '../../src/features/auth/workspace-service.ts'
import { saveRecord } from '../../src/features/workspace/record-service.ts'
import { defaultAgency, newLine } from '../../src/features/workspace/invoices/model.ts'
import { loadAgency, saveAgency, loadInvoiceSnapshot, saveAdvancedDraft } from '../../src/features/workspace/invoices/service.ts'

let env,a,b,clientId,invoiceId
const apps=[]
async function local(name){const app=initializeApp({projectId:PROJECT,apiKey:'demo-emulator-only',authDomain:'localhost'},name);const auth=getAuth(app),db=getFirestore(app);connectAuthEmulator(auth,'http://127.0.0.1:9199',{disableWarnings:true});connectFirestoreEmulator(db,'127.0.0.1',8180);apps.push({app,db});await signInWithCredential(auth,GoogleAuthProvider.credential(JSON.stringify({sub:name,email:`${name}@example.test`,email_verified:true})));await completeOnboarding(auth,db,{ownerName:name,businessName:name});return{auth,db,uid:auth.currentUser.uid}}
function fixture(){return{version:1,agency:{...defaultAgency(),name:'Agency A'},client:{name:'Client',company:'',contact:'',email:'',phone:'',whatsapp:'',address:'',gstin:''},title:'Draft',date:'2026-11-11',due:'2026-11-25',currency:'INR',priceMode:'exclusive',gstMode:'split',gstEnabled:false,discountKind:'percent',discount:'0',charges:'0',notes:'',terms:'',methods:[],lines:[{...newLine('first'),name:'Service',rate:'100'}]}}
before(async()=>{requireEmulators();env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8180,rules:await readFile('firestore.agency-invoice.proposed.rules','utf8')}});await env.clearFirestore();a=await local('agency-a');b=await local('agency-b');clientId=await saveRecord(a.auth,a.db,'clients',{name:'Client',company:'',email:'',phone:'',whatsapp:'',address:'',services:'',notes:'',status:'active'})})
after(async()=>{for(const app of apps){await terminate(app.db);await deleteApp(app.app)}await env?.cleanup()})

test('pre-upgrade backup reproduces denied agency reads/writes, snapshot reads/writes and atomic invoice creation',async()=>{
  const original=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8180,rules:await readFile('firestore.rules.before-agency-invoice.bak','utf8')}})
  try {
    await assertFails(getDoc(doc(a.db,'workspaces',a.uid,'settings','agency')))
    await assertFails(saveAgency(a.auth,a.db,{...defaultAgency(),name:'Blocked by current rules'}))
    await assertFails(getDoc(doc(a.db,'workspaces',a.uid,'invoices','blocked-current','configuration','snapshot')))
    await assertFails(setDoc(doc(a.db,'workspaces',a.uid,'invoices','blocked-current','configuration','snapshot'),{...meta(a.uid),agencyJson:'{}',clientJson:'{}',contentJson:'{}'}))
    await assertFails(saveAdvancedDraft(a.auth,a.db,fixture(),clientId,'blocked-current'))
    assert.equal((await getDoc(doc(a.db,'workspaces',a.uid,'invoices','blocked-current'))).exists(),false)
  } finally {
    await original.cleanup()
    await env.cleanup()
    env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8180,rules:await readFile('firestore.agency-invoice.proposed.rules','utf8')}})
  }
})
test('agency proposal: owner can save/edit own profile; other owner and anonymous cannot read it',async()=>{await saveAgency(a.auth,a.db,{...defaultAgency(),name:'Agency A'});const saved=await loadAgency(a.auth,a.db);assert.equal(saved.agency.name,'Agency A');await saveAgency(a.auth,a.db,{...saved.agency,name:'Agency A edited'},saved.revision);await assertFails(getDoc(doc(b.db,'workspaces',a.uid,'settings','agency')));await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'workspaces',a.uid,'settings','agency')))})
test('agency proposal: rejects ownership mutation, extra fields, excessive content, unverified/suspended users',async()=>{const ref=doc(a.db,'workspaces',a.uid,'settings','agency');await assertFails(updateDoc(ref,{ownerId:b.uid,revision:3,updatedAt:serverTimestamp()}));await assertFails(updateDoc(ref,{admin:true,revision:3,updatedAt:serverTimestamp()}));await assertFails(updateDoc(ref,{profileJson:'x'.repeat(150001),revision:3,updatedAt:serverTimestamp()}));for(const context of [identity(env,a.uid,{email_verified:false}),identity(env,b.uid)])await assertFails(getDoc(doc(context,'workspaces',a.uid,'settings','agency')));await env.withSecurityRulesDisabled(async ctx=>setDoc(doc(ctx.firestore(),'accountAccess',b.uid),{userId:b.uid,status:'suspended'}));await assertFails(getDoc(doc(b.db,'workspaces',b.uid,'settings','agency')))})
test('invoice proposal: creates atomic draft snapshot and canonical items without official numbering',async()=>{invoiceId=await saveAdvancedDraft(a.auth,a.db,fixture(),clientId,'fixed-request-id');const result=await loadInvoiceSnapshot(a.auth,a.db,invoiceId);assert.equal(result.draft.agency.name,'Agency A');assert.equal(result.revision,1);const head=await getDoc(doc(a.db,'workspaces',a.uid,'invoices',invoiceId));assert.equal(head.data().state,'draft');assert.equal(head.data().invoiceNumber,undefined);assert.equal((await getDocs(collection(a.db,'workspaces',a.uid,'invoices',invoiceId,'items'))).size,1);await assert.rejects(saveAdvancedDraft(a.auth,a.db,fixture(),clientId,'fixed-request-id'))})
test('invoice proposal: edits preserve snapshots, sum exact amounts and reject stale revisions',async()=>{const d=(await loadInvoiceSnapshot(a.auth,a.db,invoiceId)).draft;d.lines.push({...newLine('second'),name:'Second',rate:'50'});d.discount='10';d.charges='5';await saveAdvancedDraft(a.auth,a.db,d,clientId,invoiceId,1,1);const items=await getDocs(collection(a.db,'workspaces',a.uid,'invoices',invoiceId,'items'));assert.equal(items.docs.reduce((sum,row)=>sum+row.data().unitPriceMinor,0),14000);await assert.rejects(saveAdvancedDraft(a.auth,a.db,d,clientId,invoiceId,1,1));await saveAgency(a.auth,a.db,{...defaultAgency(),name:'Changed profile'},2);assert.equal((await loadInvoiceSnapshot(a.auth,a.db,invoiceId)).draft.agency.name,'Agency A');await assert.rejects(saveAdvancedDraft(a.auth,a.db,{...d,agency:{...d.agency,name:'Replaced historical agency'}},clientId,invoiceId,2,2))})
test('invoice proposal: snapshots private, immutable owner/agency, unknown paths and official operations denied',async()=>{const path=['workspaces',a.uid,'invoices',invoiceId,'configuration','snapshot'];await assertFails(getDoc(doc(b.db,...path)));await assertFails(updateDoc(doc(a.db,...path),{agencyJson:'{}',revision:3,updatedAt:serverTimestamp()}));await assertFails(updateDoc(doc(a.db,...path),{ownerId:b.uid,revision:3,updatedAt:serverTimestamp()}));await assertFails(setDoc(doc(a.db,'workspaces',a.uid,'invoices',invoiceId,'configuration','other'),{...meta(a.uid)}));await assertFails(updateDoc(doc(a.db,'workspaces',a.uid,'invoices',invoiceId),{state:'issued',invoiceNumber:'GM-INV-0001',revision:3,updatedAt:serverTimestamp()}));await assertFails(setDoc(doc(a.db,'workspaces',a.uid,'counters','invoices'),{next:2}));await assertFails(setDoc(doc(a.db,'workspaces',a.uid,'payments','invoice-payment'),{...meta(a.uid),invoiceId,amountMinor:1}));await assertFails(setDoc(doc(a.db,'publicLinks','invoice'),{ownerId:a.uid}));await assertFails(getDoc(doc(identity(env,A),'workspaces',a.uid,'settings','agency')))})

test('invoice proposal: rejects independent header, item or snapshot edits and preserves committed records',async()=>{
  const head=doc(a.db,'workspaces',a.uid,'invoices',invoiceId),snap=doc(head,'configuration','snapshot'),item=doc(head,'items','advanced-first')
  await assertFails(updateDoc(head,{title:'Bypass snapshot',revision:3,updatedAt:serverTimestamp()}))
  await assertFails(updateDoc(item,{unitPriceMinor:1,revision:3,updatedAt:serverTimestamp()}))
  await assertFails(updateDoc(snap,{contentJson:'{}',revision:3,updatedAt:serverTimestamp()}))
  assert.equal((await getDoc(snap)).data().revision,2)
  assert.equal((await getDoc(head)).data().revision,2)
})
test('proposal: active foreign owner cannot write agency or invoice data; unverified/anonymous writes denied',async()=>{
  const contexts=[identity(env,'active-foreign-owner'),identity(env,a.uid,{email_verified:false}),env.unauthenticatedContext().firestore()]
  for(const db of contexts){
    await assertFails(setDoc(doc(db,'workspaces',a.uid,'settings','agency'),{...meta(a.uid),profileJson:'{}'}))
    await assertFails(getDoc(doc(db,'workspaces',a.uid,'invoices',invoiceId,'configuration','snapshot')))
    await assertFails(updateDoc(doc(db,'workspaces',a.uid,'invoices',invoiceId,'configuration','snapshot'),{contentJson:'{}',revision:3,updatedAt:serverTimestamp()}))
  }
})
test('proposal: atomic header plus snapshot cannot replace frozen client/agency or inject privileges',async()=>{
  const head=doc(a.db,'workspaces',a.uid,'invoices',invoiceId),snap=doc(head,'configuration','snapshot')
  for(const patch of [{agencyJson:'{}'},{clientJson:'{}'},{admin:true},{workspaceId:b.uid},{createdAt:serverTimestamp()}]){
    const batch=writeBatch(a.db)
    batch.update(head,{revision:3,updatedAt:serverTimestamp()})
    batch.update(snap,{...patch,revision:3,updatedAt:serverTimestamp()})
    await assertFails(batch.commit())
  }
  assert.equal((await getDoc(head)).data().revision,2)
})
