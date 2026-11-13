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
import { createNumberedInvoice, saveAdvancedDraft, loadInvoiceSnapshot, saveAgency, loadAgency, recoverInvoiceRequest, loadAgencyDefaults } from '../../src/features/workspace/invoices/service.ts'
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
  await env.clearFirestore();name='ui-workflow-'+(++index)
  const local=await localApp(name);app=local.app;auth=local.auth;db=local.db;uid=auth.currentUser.uid
  await completeOnboarding(auth,db,{ownerName:'Owner',businessName:'Original agency'})
  await setDoc(path('clients','client'),client(uid));await setDoc(path('projects','project'),project(uid));await setDoc(path('settings','invoice'),settingsFactories.invoice(uid))
  await saveAgency(auth,db,fixture().agency)
  await env.withSecurityRulesDisabled(ctx=>initializeEmulatorCounter(ctx.firestore(),uid,[],[{id:'external-history',references:['OLD-47'],sequences:[]}],{complete:true,reviewer:'Test fixture only'}))
})
afterEach(async()=>{for(const local of extras){await terminate(local.db);await deleteApp(local.app)}extras=[];if(db)await terminate(db);if(app)await deleteApp(app)})
after(async()=>env?.cleanup())


import { suggestedPrefix, manualStatuses, originalPaymentDetails, resolveInvoiceDraft, validatePaymentDetails, invoiceReference } from '../../src/features/workspace/invoices/workflow.ts'
import { readPendingRequest, keepPendingRequest, clearPendingRequest } from '../../src/features/workspace/invoices/pending-request.ts'
import { invoicePreviewMode } from '../../src/services/invoice-preview-mode.ts'
import { createInvoicePdf } from '../../src/features/workspace/invoices/pdf.ts'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { importPreview, existingWhatsAppHandlers } from './helpers/invoice-compatibility.mjs'
import { money } from '../../src/features/workspace/money.ts'

test('saved payment overrides remain readable and editable with candidate creation disabled',async()=>{
  await create('rollback-payment')
  const loaded=await loadInvoiceSnapshot(auth,db,'rollback-payment')
  const payment={...originalPaymentDetails(loaded.draft.agency),upiId:'saved-invoice@bank',instructions:'Invoice-specific historical instructions'}
  await saveAdvancedDraft(auth,db,loaded.draft,'client','rollback-payment',loaded.header.revision,loaded.revision,{paymentOverride:payment,usePaymentOverride:true})
  const disabled=await loadInvoiceSnapshot(auth,db,'rollback-payment',false)
  assert.deepEqual(disabled.paymentOverride,payment)
  disabled.draft.notes='Edited while creation disabled'
  await saveAdvancedDraft(auth,db,disabled.draft,'client','rollback-payment',disabled.header.revision,disabled.revision,{usePaymentOverride:false})
  const after=await loadInvoiceSnapshot(auth,db,'rollback-payment',false)
  assert.deepEqual(after.paymentOverride,payment);assert.equal(after.draft.agency.upiId,'original@bank')
  const preview=renderToStaticMarkup(createElement((await importPreview()).InvoicePreview,{draft:after.draft,presentation:{reference:after.reference,paymentOverride:after.paymentOverride}}))
  assert.match(preview,/saved-invoice@bank/);assert.doesNotMatch(preview,/original@bank/)
})

test('rolling rules back to deny override reads fails closed instead of replacing payment instructions',async()=>{
  await create('denied-payment')
  const originalRules=await readFile(process.env.GROWTHMARK_INVOICE_RULES_FILE === 'firestore.release.rules' ? 'firestore.release.rules' : 'firestore.invoice-workflow.candidate.rules','utf8')
  const denied=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8180,rules:await readFile('firestore.production.proposed.rules','utf8')}})
  try {await assert.rejects(loadInvoiceSnapshot(auth,db,'denied-payment',false),error=>error.code==='permission-denied')}
  finally {await denied.cleanup();await env.cleanup();env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8180,rules:originalRules}})}
})

test('service recovery and edits use protected identity even after JSON marker tampering',async()=>{
  await create('protected-recovery');const before=await counter()
  for(const marker of [undefined,null,{version:1,invoiceId:'protected-recovery',requestId:'forged-request'}]){
    const snapshot=(await getDoc(path('invoices','protected-recovery','configuration','snapshot'))).data()
    const content=JSON.parse(snapshot.contentJson);delete content._allocation;if(marker!==undefined)content._allocation=marker
    await env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),'workspaces',uid,'invoices','protected-recovery','configuration','snapshot'),{contentJson:JSON.stringify(content)}))
    const saved=await recoverInvoiceRequest(auth,db,{version:1,ownerId:uid,invoiceId:'protected-recovery',requestId:'request-protected-recovery',submitted:true})
    assert.equal(saved.allocation.requestId,'request-protected-recovery')
    await assert.rejects(recoverInvoiceRequest(auth,db,{version:1,ownerId:uid,invoiceId:'protected-recovery',requestId:'forged-request',submitted:true}),/protected allocation request/)
    saved.draft.notes='Ordinary edit';await saveAdvancedDraft(auth,db,saved.draft,'client','protected-recovery',saved.header.revision,saved.revision)
    assert.equal(JSON.parse((await getDoc(path('invoices','protected-recovery','configuration','snapshot'))).data().contentJson)._allocation.requestId,'request-protected-recovery')
  }
  assert.deepEqual(await counter(),before)
})

test('legacy fifty-line invoices plus charges remain editable under hardened candidate rules',async()=>{
  const draft=fixture();draft.lines=Array.from({length:50},(_,i)=>({...draft.lines[0],id:'legacy-'+i}))
  await seedLegacyInvoice(env,uid,draft,'client','legacy-large');const before=await counter()
  const saved=await loadInvoiceSnapshot(auth,db,'legacy-large');saved.draft.notes='Legacy large edit'
  await saveAdvancedDraft(auth,db,saved.draft,'client','legacy-large',saved.header.revision,saved.revision)
  assert.equal((await getDocs(collection(db,'workspaces',uid,'invoices','legacy-large','items'))).size,51)
  assert.equal((await getDoc(path('invoices','legacy-large'))).data().allocation,undefined);assert.deepEqual(await counter(),before)
})

test('prefix settings are authoritative, preserve other preferences and affect only future references',async()=>{
  await setDoc(path('settings','business'),{...settingsFactories.business(uid),name:'Legacy business',email:'legacy@example.test'});const defaults=await loadAgencyDefaults(auth,db);assert.equal(defaults.business.email,'legacy@example.test');assert.equal(defaults.invoice.invoicePrefix,'INV')
  const original=await create('before-prefix'),before=await counter(),settings=(await getDoc(path('settings','invoice'))).data(),agency=await loadAgency(auth,db)
  await saveAgency(auth,db,agency.agency,agency.revision,'ACME-INV')
  assert.deepEqual(await counter(),before)
  const after=(await getDoc(path('settings','invoice'))).data()
  for(const key of ['quotationPrefix','footer','defaultTaxBps','defaultDiscountBps','paymentTermsDays'])assert.deepEqual(after[key],settings[key])
  assert.equal((await loadAgency(auth,db)).invoicePrefix,'ACME-INV')
  assert.equal((await create('after-prefix')).prefix,'ACME-INV')
  assert.equal((await loadInvoiceSnapshot(auth,db,'before-prefix',true)).reference,'INV-000048')
  assert.equal(original.sequence,48)
})
test('prefix defaults derive from business name without a shared GrowthMark prefix',()=>{
  assert.equal(suggestedPrefix('Mihras Digital'),'MD-INV');assert.equal(suggestedPrefix('Acme'),'ACME-INV');assert.equal(suggestedPrefix(''),'INV');assert.notEqual(defaultAgency().prefix,'GM-INV')
  assert.equal(invoiceReference({invoiceNumber:'Historical / 2025 / 42'}),'Historical / 2025 / 42')
  assert.equal(invoiceReference({numberPrefix:'invalid/prefix',numberSequence:42}),'')
})
test('six manual labels remain separate from lifecycle, payment records and collected revenue',async()=>{
  await create('statuses');const before=await counter(),snap=(await getDoc(path('invoices','statuses','configuration','snapshot'))).data()
  for(const manualStatus of manualStatuses){
    const saved=await loadInvoiceSnapshot(auth,db,'statuses',true)
    await saveAdvancedDraft(auth,db,saved.draft,'client','statuses',saved.header.revision,saved.revision,{manualStatus,usePaymentOverride:true})
    const after=await loadInvoiceSnapshot(auth,db,'statuses',true)
    assert.equal(after.manualStatus,manualStatus);assert.equal(after.header.state,'draft')
    assert.equal((await getDocs(collection(db,'workspaces',uid,'payments'))).size,0)
    const frozen=(await getDoc(path('invoices','statuses','configuration','snapshot'))).data();assert.equal(frozen.agencyJson,snap.agencyJson);assert.equal(frozen.clientJson,snap.clientJson)
  }
  assert.deepEqual(await counter(),before)
  const current=await loadInvoiceSnapshot(auth,db,'statuses',true)
  await assert.rejects(saveAdvancedDraft(auth,db,current.draft,'client','statuses',current.header.revision,current.revision,{manualStatus:'verified-paid',usePaymentOverride:true}),/valid manual invoice status/)
})
const bankOverride=()=>({...originalPaymentDetails(fixture().agency),upiEnabled:false,bankEnabled:true,bankHolder:'Invoice holder',bankName:'Invoice-only bank',accountNumber:'9876543210',ifsc:'ABCD0123456',instructions:'Invoice-only instructions'})
test('payment override enables an invoice method, resolves consistently and never modifies agency snapshots/settings',async()=>{
  await create('payments');const saved=await loadInvoiceSnapshot(auth,db,'payments',true),profile=(await getDoc(path('settings','agency'))).data(),snapshot=(await getDoc(path('invoices','payments','configuration','snapshot'))).data()
  saved.draft.methods=['bank']
  await saveAdvancedDraft(auth,db,saved.draft,'client','payments',saved.header.revision,saved.revision,{usePaymentOverride:true,paymentOverride:bankOverride()})
  const loaded=await loadInvoiceSnapshot(auth,db,'payments',true),effective=resolveInvoiceDraft(loaded.draft,loaded.paymentOverride)
  assert.equal(loaded.draft.agency.bankEnabled,'false');assert.equal(effective.agency.bankName,'Invoice-only bank');assert.deepEqual(effective.methods,['bank'])
  assert.deepEqual((await getDoc(path('settings','agency'))).data(),profile)
  const after=(await getDoc(path('invoices','payments','configuration','snapshot'))).data();assert.equal(after.agencyJson,snapshot.agencyJson);assert.equal(after.clientJson,snapshot.clientJson)
  const {InvoicePreview}=await importPreview(),html=renderToStaticMarkup(createElement(InvoicePreview,{draft:loaded.draft,presentation:{reference:loaded.reference,manualStatus:'paid',paymentOverride:loaded.paymentOverride}}))
  assert.match(html,/Invoice-only bank/);assert.match(html,/9876543210/);assert.match(html,/payment not verified/);assert.match(html,/INV-000048/)
  const font=(await readFile('public/fonts/NotoSans-Regular.ttf')).toString('base64'),pdf=await createInvoicePdf(loaded.draft,font,{reference:loaded.reference,manualStatus:'paid',paymentOverride:loaded.paymentOverride})
  assert.ok(Buffer.from(pdf).toString('latin1').startsWith('%PDF-'))
})
test('reset uses the invoice original snapshot instead of current Agency Settings and preserves override history revision',async()=>{
  await create('reset');let saved=await loadInvoiceSnapshot(auth,db,'reset',true);saved.draft.methods=['bank']
  await saveAdvancedDraft(auth,db,saved.draft,'client','reset',1,1,{usePaymentOverride:true,paymentOverride:bankOverride()})
  const agency=await loadAgency(auth,db);await saveAgency(auth,db,{...agency.agency,instructions:'Changed global instructions'},agency.revision)
  saved=await loadInvoiceSnapshot(auth,db,'reset',true);saved.draft.methods=['upi']
  await saveAdvancedDraft(auth,db,saved.draft,'client','reset',saved.header.revision,saved.revision,{usePaymentOverride:true,paymentOverride:originalPaymentDetails(saved.draft.agency),expectedPaymentRevision:saved.paymentRevision})
  const reset=await loadInvoiceSnapshot(auth,db,'reset',true)
  assert.equal(reset.paymentOverride.instructions,'Original payment instructions');assert.equal(reset.paymentRevision,2);assert.equal((await loadAgency(auth,db)).agency.instructions,'Changed global instructions')
})
test('stale or malformed payment override fails without partial updates',async()=>{
  await create('stale-payment');let saved=await loadInvoiceSnapshot(auth,db,'stale-payment',true)
  saved.draft.methods=['bank']
  await saveAdvancedDraft(auth,db,saved.draft,'client','stale-payment',1,1,{usePaymentOverride:true,paymentOverride:bankOverride()})
  saved=await loadInvoiceSnapshot(auth,db,'stale-payment',true);const before=(await getDoc(path('invoices','stale-payment'))).data()
  await assert.rejects(saveAdvancedDraft(auth,db,saved.draft,'client','stale-payment',saved.header.revision,saved.revision,{usePaymentOverride:true,paymentOverride:bankOverride(),expectedPaymentRevision:0}),/changed in another window/)
  await assert.rejects(saveAdvancedDraft(auth,db,saved.draft,'client','stale-payment',saved.header.revision,saved.revision,{usePaymentOverride:true,paymentOverride:{...bankOverride(),admin:true},expectedPaymentRevision:1}),/Unexpected invoice payment fields/)
  assert.deepEqual((await getDoc(path('invoices','stale-payment'))).data(),before)
})
test('pending requests retain stable IDs across refresh, are account-scoped and contain no invoice/banking data',()=>{
  const entries=new Map(),storage={getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)}
  const pending={version:1,ownerId:uid,invoiceId:'stable-invoice',requestId:'stable-request',submitted:true}
  keepPendingRequest(storage,pending);assert.deepEqual(readPendingRequest(storage,uid),pending);assert.equal(readPendingRequest(storage,'different-owner'),null)
  assert.deepEqual(Object.keys(JSON.parse([...entries.values()][0])).sort(),['invoiceId','ownerId','requestId','submitted','version'])
  clearPendingRequest(storage,'different-owner');assert.deepEqual(readPendingRequest(storage,uid),pending)
  clearPendingRequest(storage,uid);assert.equal(readPendingRequest(storage,uid),null)
})
test('corrupt pending storage blocks recovery rather than silently issuing fresh request IDs',()=>{
  const storage={getItem:()=>'{broken',setItem:()=>{},removeItem:()=>{}}
  assert.throws(()=>readPendingRequest(storage,uid),/unreadable/)
})
test('confirmed recovery matches request identity, returns original number, and does not advance counter',async()=>{
  const pending={version:1,ownerId:uid,invoiceId:'recovery',requestId:'request-recovery',submitted:true}
  assert.equal(await recoverInvoiceRequest(auth,db,pending),null)
  await create('recovery');const before=await counter()
  const saved=await recoverInvoiceRequest(auth,db,pending);assert.equal(saved.reference,'INV-000048')
  await assert.rejects(recoverInvoiceRequest(auth,db,{...pending,requestId:'different'}),/does not match/)
  await assert.rejects(recoverInvoiceRequest(auth,db,{...pending,ownerId:'another-owner'}),/another account/)
  assert.deepEqual(await counter(),before)
})
test('WhatsApp uses only the confirmed reference and the existing safe message-only URL',async()=>{
  await create('share');const saved=await loadInvoiceSnapshot(auth,db,'share',true),handlers=await existingWhatsAppHandlers();let message,opened
  handlers.message(saved.draft,calculateInvoice,money,value=>message=value,error=>{throw error},saved.reference)
  assert.match(message,/INV-000048/)
  handlers.open(saved.draft,message,error=>{throw error},{open:(...args)=>opened=args})
  assert.equal(new URL(opened[0]).searchParams.get('text'),message);assert.equal(opened[2],'noopener,noreferrer')
})
test('candidate preview is development-and-emulator only and cannot override production mode',()=>{
  assert.equal(invoicePreviewMode('true',true,true),true)
  assert.equal(invoicePreviewMode(undefined,false,false),false)
  assert.throws(()=>invoicePreviewMode('true',false,true));assert.throws(()=>invoicePreviewMode('true',true,false))
})

test('malformed override ownership is rejected on read and edit without fallback or partial changes',async()=>{
  await create('owner-check');const saved=await loadInvoiceSnapshot(auth,db,'owner-check',true),snapshot=(await getDoc(path('invoices','owner-check','configuration','snapshot'))).data()
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'workspaces',uid,'invoices','owner-check','configuration','paymentOverride'),{schemaVersion:1,workspaceId:uid,ownerId:'foreign-owner',revision:1,createdAt:snapshot.createdAt,updatedAt:snapshot.updatedAt,details:bankOverride()}))
  await assert.rejects(loadInvoiceSnapshot(auth,db,'owner-check',true),/payment ownership/)
  await assert.rejects(saveAdvancedDraft(auth,db,saved.draft,'client','owner-check',1,1,{usePaymentOverride:true}),/payment ownership/)
  assert.equal((await getDoc(path('invoices','owner-check'))).data().revision,1)
  assert.equal((await counter()).lastSequence,48)
})
