import { before, beforeEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { initializeApp, deleteApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, GoogleAuthProvider, signInWithCredential } from 'firebase/auth'
import { collection, doc, getDoc, getDocs, getFirestore, connectFirestoreEmulator, setDoc, terminate, Timestamp } from 'firebase/firestore'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PROJECT, requireEmulators } from './helpers.mjs'
import { completeOnboarding } from '../../src/features/auth/workspace-service.ts'
import { defaultAgency, newLine, calculateInvoice } from '../../src/features/workspace/invoices/model.ts'
import { loadInvoiceSnapshot, saveAdvancedDraft } from '../../src/features/workspace/invoices/service.ts'
import { createInvoicePdf } from '../../src/features/workspace/invoices/pdf.ts'
import { money } from '../../src/features/workspace/money.ts'
import { importPreview, existingWhatsAppHandlers } from './helpers/invoice-compatibility.mjs'
import { decodeInvoiceSnapshot, validateAllocationMetadata } from '../../src/features/workspace/invoices/snapshot-codec.ts'

let env, account, index = 0, InvoicePreview, whatsapp, font
const apps = []
const time = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'))
const allocation = id => ({ version: 1, invoiceId: id, requestId: `request-${id}` })
function fixture() {
  return { version:1, agency:{...defaultAgency(),name:'Historical agency',ownerName:'Owner',upiEnabled:'true',upiId:'original@bank',upiHolder:'Original holder',bankEnabled:'true',bankHolder:'Original holder',bankName:'Original bank',accountNumber:'1234567890',ifsc:'ABCD0123456',instructions:'Original payment instructions'},
    client:{name:'Historical client',company:'',contact:'',email:'',phone:'',whatsapp:'919876543210',address:'',gstin:''},title:'Services',date:'2026-01-01',due:'2026-01-15',currency:'INR',priceMode:'exclusive',gstMode:'split',gstEnabled:false,discountKind:'percent',discount:'0',charges:'0',notes:'Original notes',terms:'Original terms',methods:['upi','bank'],lines:[{...newLine('service'),name:'Consulting',rate:'100'}] }
}
function path(...parts) { return doc(account.db,'workspaces',account.uid,...parts) }
async function seed(id, marker, numbered = false, rawContent) {
  const draft = fixture(), {agency,client,...content} = draft
  const meta = {schemaVersion:1,workspaceId:account.uid,ownerId:account.uid,revision:1,createdAt:time,updatedAt:time}
  const payload = { ...content, ...(marker === undefined ? {} : {_allocation:marker}) }
  const snapshot = {...meta,agencyJson:JSON.stringify(agency),clientJson:JSON.stringify(client),contentJson:rawContent??JSON.stringify(payload)}
  const head = {...meta,clientId:'client',projectId:null,title:draft.title,state:'draft',issueAt:time,dueAt:Timestamp.fromDate(new Date('2026-01-15T00:00:00Z')),terms:draft.terms,notes:draft.notes,...(numbered?{numberPrefix:'HIST-INV',numberSequence:42}:{})}
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore(), base=['workspaces',account.uid]
    await setDoc(doc(db,...base,'clients','client'),{...meta,name:'Historical client',company:'',email:'',phone:'',whatsapp:'919876543210',address:'',services:'',notes:'',status:'active'})
    await setDoc(doc(db,...base,'invoices',id),head)
    await setDoc(doc(db,...base,'invoices',id,'configuration','snapshot'),snapshot)
    await setDoc(doc(db,...base,'invoices',id,'items','advanced-service'),{...meta,description:'Consulting',quantityMilli:1000,unitPriceMinor:10000,taxRateBps:0,discountBps:0})
  })
  return {draft,snapshot,head}
}
async function edit(id,draft) { draft.notes='Edited notes';await saveAdvancedDraft(account.auth,account.db,draft,'client',id,1,1) }
async function stored(id) { return (await getDoc(path('invoices',id,'configuration','snapshot'))).data() }

before(async()=>{
  requireEmulators()
  // Load unchanged candidate rules only into the isolated test emulator; never publish.
  env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8180,rules:await readFile(process.env.GROWTHMARK_INVOICE_RULES_FILE === 'firestore.release.rules' ? 'firestore.release.rules' : 'firestore.invoice-workflow.candidate.rules','utf8')}})
  ;({InvoicePreview}=await importPreview());whatsapp=await existingWhatsAppHandlers();font=(await readFile('public/fonts/NotoSans-Regular.ttf')).toString('base64')
})
beforeEach(async()=>{
  await env.clearFirestore()
  const name=`compatibility-${++index}`,app=initializeApp({projectId:PROJECT,apiKey:'demo-emulator-only',authDomain:'localhost'},name),auth=getAuth(app),db=getFirestore(app)
  connectAuthEmulator(auth,'http://127.0.0.1:9199',{disableWarnings:true});connectFirestoreEmulator(db,'127.0.0.1',8180)
  apps.push({app,db});await signInWithCredential(auth,GoogleAuthProvider.credential(JSON.stringify({sub:name,email:`${name}@example.test`,email_verified:true})))
  account={auth,db,uid:auth.currentUser.uid};await completeOnboarding(auth,db,{ownerName:'Owner',businessName:'Historical agency'})
})
after(async()=>{for(const {app,db}of apps){await terminate(db);await deleteApp(app)}await env?.cleanup()})

test('legacy snapshot without allocation metadata loads through the existing service',async()=>{
  const original=await seed('legacy');const loaded=await loadInvoiceSnapshot(account.auth,account.db,'legacy')
  assert.deepEqual(loaded.draft,original.draft);assert.equal(loaded.revision,1)
})
test('historical number components survive existing invoice loading and editing',async()=>{
  await seed('historical',undefined,true)
  const loaded=await loadInvoiceSnapshot(account.auth,account.db,'historical');await edit('historical',loaded.draft)
  const header=(await getDoc(path('invoices','historical'))).data()
  assert.equal(header.numberPrefix,'HIST-INV');assert.equal(header.numberSequence,42)
  assert.equal('_allocation' in JSON.parse((await stored('historical')).contentJson),false)
})
test('REQUIRED compatibility: valid candidate allocation metadata loads through existing service',async()=>{
  const original=await seed('candidate',allocation('candidate'),true)
  const loaded=await loadInvoiceSnapshot(account.auth,account.db,'candidate')
  assert.deepEqual(loaded.draft,original.draft)
  assert.deepEqual(loaded.allocation,allocation('candidate'))
  assert.equal(Object.hasOwn(loaded.draft,'_allocation'),false)
})
test('REQUIRED compatibility: editing a candidate preserves allocation metadata exactly',async()=>{
  const id='candidate-edit',original=await seed(id,allocation(id),true)
  // Supply the known valid form directly to exercise the writer independently of loader failure.
  await edit(id,original.draft)
  assert.deepEqual(JSON.parse((await stored(id)).contentJson)._allocation,allocation(id))
})
test('editing legacy invoice does not introduce allocation metadata',async()=>{
  const id='legacy-edit';await seed(id);const loaded=await loadInvoiceSnapshot(account.auth,account.db,id);await edit(id,loaded.draft)
  const content=JSON.parse((await stored(id)).contentJson)
  assert.equal(Object.hasOwn(content,'_allocation'),false);assert.equal(content.notes,'Edited notes')
})
test('existing save preserves original agency and client JSON for legacy and candidate invoices',async()=>{
  for(const candidate of [false,true]){
    const id=candidate?'frozen-candidate':'frozen-legacy',original=await seed(id,candidate?allocation(id):undefined,candidate)
    await edit(id,original.draft);const after=await stored(id)
    assert.equal(after.agencyJson,original.snapshot.agencyJson);assert.equal(after.clientJson,original.snapshot.clientJson)
  }
})
test('original UPI/bank instructions remain available after editing existing and candidate snapshots',async()=>{
  for(const candidate of [false,true]){
    const id=candidate?'payment-candidate':'payment-legacy',original=await seed(id,candidate?allocation(id):undefined,candidate)
    await edit(id,original.draft);const loaded=await loadInvoiceSnapshot(account.auth,account.db,id)
    assert.equal(loaded.draft.agency.upiId,'original@bank');assert.equal(loaded.draft.agency.accountNumber,'1234567890');assert.equal(loaded.draft.agency.instructions,'Original payment instructions');assert.deepEqual(loaded.draft.methods,['upi','bank'])
  }
})
test('invalid allocation markers are rejected without modifying any stored snapshot',async()=>{
  const markers=[null,{},'wrong-type',{version:2,invoiceId:'invalid-3',requestId:'request-invalid'},{version:1,invoiceId:'other-invoice',requestId:'request-invalid'},{version:1,invoiceId:'invalid-5',requestId:42},{version:1,invoiceId:'invalid-6',requestId:'request-invalid',admin:true}]
  for(let i=0;i<markers.length;i++){
    const id='invalid-'+i,original=await seed(id,markers[i],true)
    await assert.rejects(loadInvoiceSnapshot(account.auth,account.db,id),/Invalid invoice allocation metadata/)
    assert.deepEqual(await stored(id),original.snapshot)
  }
})
test('malformed snapshot JSON is rejected without a write',async()=>{
  const original=await seed('malformed',undefined,false,'{"_allocation":')
  await assert.rejects(loadInvoiceSnapshot(account.auth,account.db,'malformed'),SyntaxError)
  assert.deepEqual(await stored('malformed'),original.snapshot)
})

async function presentation(id,marker){
  await seed(id,marker,marker!==undefined)
  const loaded=await loadInvoiceSnapshot(account.auth,account.db,id),draft=loaded.draft
  const html=renderToStaticMarkup(createElement(InvoicePreview,{draft}))
  assert.match(html,/Historical agency/);assert.match(html,/Historical client/);assert.match(html,/original@bank/);assert.match(html,/1234567890/);assert.match(html,/DRAFT/)
  const pdf=Buffer.from(await createInvoicePdf(draft,font)).toString('latin1')
  assert.ok(pdf.startsWith('%PDF-'));assert.match(pdf,/DRAFT - NOT ISSUED/)
  let message,opened;const errors=[]
  whatsapp.message(draft,calculateInvoice,money,value=>message=value,e=>errors.push(e))
  assert.match(message,/Historical client/);assert.match(message,/Historical agency/);assert.match(message,/100\.00/)
  whatsapp.open(draft,message,e=>errors.push(e),{open:(...args)=>opened=args})
  assert.equal(errors.length,0);const url=new URL(opened[0]);assert.equal(url.hostname,'wa.me');assert.equal(url.pathname,'/919876543210');assert.equal(url.searchParams.get('text'),message)
  assert.equal(opened[2],'noopener,noreferrer')
}
test('legacy loaded invoice remains compatible with actual preview, PDF and WhatsApp handlers',()=>presentation('legacy-presentation'))
test('REQUIRED compatibility: candidate loaded invoice works with preview, PDF and WhatsApp handlers',()=>presentation('candidate-presentation',allocation('candidate-presentation')))

test('legacy editable canonical items retain their original calculated total',async()=>{
  const original=await seed('items');await edit('items',original.draft)
  const items=await getDocs(collection(account.db,'workspaces',account.uid,'invoices','items','items'))
  assert.equal(items.docs.reduce((sum,row)=>sum+row.data().unitPriceMinor,0),calculateInvoice(original.draft).total)
})

test('allocation validator rejects missing, extra, unsafe, mismatched and wrongly typed fields',()=>{
  const valid=allocation('validator')
  const invalid=[undefined,null,[],{},...Object.keys(valid).map(key=>Object.fromEntries(Object.entries(valid).filter(([k])=>k!==key))),
    {...valid,version:'1'},{...valid,version:2},{...valid,requestId:''},{...valid,requestId:'bad/id'},{...valid,requestId:'x'.repeat(129)},
    {...valid,invoiceId:42},{...valid,invoiceId:'different'},{...valid,admin:true},{...valid,requestId:null}]
  for(const marker of invalid)assert.throws(()=>validateAllocationMetadata(marker,'validator'),/Invalid invoice allocation metadata/)
  assert.deepEqual(validateAllocationMetadata(valid,'validator'),valid)
})

test('ordinary draft input cannot replace, inject or strip candidate allocation metadata',async()=>{
  const id='edit-protection',original=await seed(id,allocation(id),true)
  const loaded=await loadInvoiceSnapshot(account.auth,account.db,id)
  assert.ok(Object.isFrozen(loaded.allocation))
  assert.throws(()=>{loaded.allocation.requestId='replacement'},TypeError)
  // Even a separately replaced caller-side return value is never a save parameter.
  loaded.allocation={...allocation(id),requestId:'caller-replacement'}
  for(const field of ['_allocation','allocation']){
    await assert.rejects(saveAdvancedDraft(account.auth,account.db,{...loaded.draft,[field]:loaded.allocation},'client',id,1,1),/Invoice contains unexpected fields/)
    assert.deepEqual(await stored(id),original.snapshot)
  }
  await edit(id,loaded.draft)
  assert.deepEqual(JSON.parse((await stored(id)).contentJson)._allocation,allocation(id))
})

test('malformed stored allocation cannot be silently removed by an ordinary edit',async()=>{
  const id='malformed-edit',original=await seed(id,{version:1,invoiceId:id},true)
  const header=(await getDoc(path('invoices',id))).data()
  await assert.rejects(edit(id,original.draft),/Invalid invoice allocation metadata/)
  assert.deepEqual(await stored(id),original.snapshot)
  assert.deepEqual((await getDoc(path('invoices',id))).data(),header)
})

test('repeated candidate edits preserve metadata, number and frozen identity snapshots',async()=>{
  const id='repeat-edit',original=await seed(id,allocation(id),true)
  for(let revision=1;revision<=3;revision++){
    const loaded=await loadInvoiceSnapshot(account.auth,account.db,id)
    loaded.draft.notes=`Edit ${revision}`
    await saveAdvancedDraft(account.auth,account.db,loaded.draft,'client',id,revision,revision)
    const after=await stored(id),head=(await getDoc(path('invoices',id))).data()
    assert.deepEqual(JSON.parse(after.contentJson)._allocation,allocation(id))
    assert.equal(after.agencyJson,original.snapshot.agencyJson);assert.equal(after.clientJson,original.snapshot.clientJson)
    assert.equal(head.numberPrefix,'HIST-INV');assert.equal(head.numberSequence,42)
  }
})

test('legacy identifiers up to the existing 150-character limit and basic drafts stay compatible',async()=>{
  const id='l'.repeat(150);await seed(id)
  const loaded=await loadInvoiceSnapshot(account.auth,account.db,id);assert.equal(loaded.allocation,undefined)
  await edit(id,loaded.draft);assert.equal(Object.hasOwn(JSON.parse((await stored(id)).contentJson),'_allocation'),false)
  assert.equal(await loadInvoiceSnapshot(account.auth,account.db,'no-advanced-snapshot'),null)
})

test('unknown content fields remain rejected and legacy absence differs from invalid marker',()=>{
  const {agency,client,...content}=fixture()
  const envelope=value=>({agencyJson:JSON.stringify(agency),clientJson:JSON.stringify(client),contentJson:JSON.stringify(value)})
  assert.throws(()=>decodeInvoiceSnapshot(envelope({...content,admin:true}),'unknown'),/Invoice contains unexpected fields/)
  assert.throws(()=>decodeInvoiceSnapshot(envelope({...content,_allocation:null}),'unknown'),/Invalid invoice allocation metadata/)
  for(const value of [null,[],42,'text'])assert.throws(()=>decodeInvoiceSnapshot(envelope(value),'unknown'),/Invalid invoice snapshot content/)
  assert.equal(decodeInvoiceSnapshot(envelope(content),'legacy').allocation,undefined)
})
