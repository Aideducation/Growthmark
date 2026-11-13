import {before,beforeEach,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing'
import {doc,setDoc,getDoc,deleteDoc,collection,getDocs} from 'firebase/firestore'
import {PROJECT,requireEmulators,identity,bootstrap} from './helpers.mjs'
let env,a,b
const ref=db=>doc(db,'workspaces','read-owner','invoices','legacy','configuration','paymentOverride')
before(async()=>{requireEmulators();env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8180,rules:await readFile('firestore.invoice-read-compatibility.proposed.rules','utf8')}})})
beforeEach(async()=>{await env.clearFirestore();a=identity(env,'read-owner');b=identity(env,'read-foreign');await bootstrap(a,'read-owner')})
after(async()=>env?.cleanup())
test('read compatibility permits only verified active owner GET, including an absent override',async()=>{
  assert.equal((await getDoc(ref(a))).exists(),false)
  await env.withSecurityRulesDisabled(ctx=>setDoc(ref(ctx.firestore()),{details:{instructions:'Historical private instructions'}}))
  assert.equal((await getDoc(ref(a))).data().details.instructions,'Historical private instructions')
  for(const db of [b,identity(env,'read-owner',{email_verified:false}),env.unauthenticatedContext().firestore()])await assertFails(getDoc(ref(db)))
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'accountAccess','read-owner'),{userId:'read-owner',status:'suspended'}))
  await assertFails(getDoc(ref(a)))
})
test('read compatibility never permits override writes, lists, deletion or unknown paths',async()=>{
  await assertFails(setDoc(ref(a),{details:{instructions:'Cannot write'}}));await assertFails(deleteDoc(ref(a)))
  await assertFails(getDocs(collection(a,'workspaces','read-owner','invoices','legacy','configuration')))
  await assertFails(getDoc(doc(a,'workspaces','read-owner','invoices','legacy','configuration','unknown')))
})
