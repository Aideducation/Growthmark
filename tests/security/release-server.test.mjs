import {test} from 'node:test'
import assert from 'node:assert/strict'
import {verifyFirebaseUser,trustedStore} from '../../server/firebase-server.mjs'
import {workspaceHandler} from '../../functions/api/workspace.js'
import {invoiceWorkflowEnabled} from '../../src/services/invoice-release-mode.ts'
import {invoiceItemLimitError} from '../../src/features/workspace/invoices/item-limit.ts'
import {encode,decode} from '../../server/firestore-rest.mjs'
import {provisionNewWorkspace} from '../../server/workspace-provisioning.mjs'
const env={FIREBASE_PROJECT_ID:'growthmark-c0e9c',FIREBASE_WEB_API_KEY:'test-public-key',WORKSPACE_PROVISIONING_ENABLED:'true',WORKSPACE_NEW_ACCOUNTS_AFTER:'2026-01-01T00:00:00Z'}
const claims={aud:'growthmark-c0e9c',iss:'https://securetoken.google.com/growthmark-c0e9c',sub:'test-owner',email:'owner@example.test',email_verified:true,exp:2000,iat:900,auth_time:900,firebase:{sign_in_provider:'password'}}
const token=c=>Buffer.from(JSON.stringify({alg:'RS256',kid:'test-only-key'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(c)).toString('base64url')+'.test-signature'
const lookup=overrides=>async url=>{assert.ok(url.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='));return Response.json({users:[{localId:'test-owner',email:'owner@example.test',emailVerified:true,createdAt:'1000',...overrides}]})}
test('server authorization requires Google token verification, expected project, verified active session',async()=>{
  assert.equal((await verifyFirebaseUser(token(claims),env,lookup({}),1000)).uid,'test-owner')
  for(const patch of [{aud:'foreign'},{iss:'foreign'},{exp:999},{iat:2000},{auth_time:2000},{email_verified:false},{sub:'foreign'},{firebase:{sign_in_provider:'anonymous'}}])await assert.rejects(verifyFirebaseUser(token({...claims,...patch}),env,lookup({}),1000))
  for(const patch of [{disabled:true},{emailVerified:false},{validSince:'950'},{localId:'foreign'}])await assert.rejects(verifyFirebaseUser(token(claims),env,lookup(patch),1000))
  await assert.rejects(verifyFirebaseUser(token(claims),env,async()=>new Response('',{status:400}),1000))
})
test('server endpoint denies cross-origin, unsigned, oversized, ownership injection and disabled provisioning',async()=>{
  let calls=0;const handle=workspaceHandler({verify:async()=>{calls++;throw new Error('Test denial')},store:()=>{throw new Error('Must not open database')}})
  const request=(body,headers={},method='POST')=>new Request('https://growthmark.pages.dev/api/workspace',{method,headers:{Origin:'https://growthmark.pages.dev','Content-Type':'application/json',Authorization:'Bearer test',...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})})
  assert.equal((await handle({request:request({}, {},'GET'),env})).status,405)
  assert.equal((await handle({request:request({}, {Origin:'https://evil.example'}),env})).status,403)
  assert.equal((await handle({request:request({}, {Authorization:''}),env})).status,401)
  assert.equal((await handle({request:request({ownerName:'x'.repeat(3000)}),env})).status,413)
  assert.equal((await handle({request:request({ownerName:'Owner',businessName:'Business',uid:'foreign'}),env})).status,409)
  assert.equal((await handle({request:request({ownerName:'Owner',businessName:'Business'}),env:{...env,WORKSPACE_PROVISIONING_ENABLED:'false'}})).status,503)
  assert.equal(calls,0)
})
test('production invoice enablement is independent of local candidate flag and supports safe disablement',()=>{
  assert.equal(invoiceWorkflowEnabled('true',false,false),true);assert.equal(invoiceWorkflowEnabled('false',false,false),false)
  assert.equal(invoiceWorkflowEnabled(undefined,true,true),true)
  assert.throws(()=>invoiceWorkflowEnabled('true',true,false));assert.throws(()=>invoiceWorkflowEnabled('yes',false,false))
})
test('UI item-count validation covers new/protected invoices and preserves large legacy edits',()=>{
  assert.equal(invoiceItemLimitError(8,'0',true),'');assert.equal(invoiceItemLimitError(7,'5',true),'')
  assert.match(invoiceItemLimitError(8,'5',true),/eight item records/);assert.match(invoiceItemLimitError(9,'0',true),/eight item records/)
  assert.equal(invoiceItemLimitError(50,'5',false),'')
})
test('REST codec preserves timestamps and transaction metadata without credential files',()=>{
  const data={a:1,b:true,c:null,d:[1,'x'],createdAt:{$timestamp:'2026-01-01T00:00:00Z'}};assert.deepEqual(decode(encode(data)),data)
})
test('trusted server rejects foreign project, emulator configuration and missing credentials',async()=>{
  for(const options of [{...env,FIREBASE_PROJECT_ID:'foreign'},{...env,FIRESTORE_EMULATOR_HOST:'localhost:8080'},env])await assert.rejects(trustedStore(options,()=>{throw new Error('Must not fetch')}))
})
test('server OAuth signer uses an ephemeral test key, fixed scope and fixed Google endpoint',async()=>{
  // Generated only in memory; not a real service-account credential or a key file.
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify'])
  const pem='-----BEGIN PRIVATE KEY-----\n'+Buffer.from(await crypto.subtle.exportKey('pkcs8',pair.privateKey)).toString('base64')+'\n-----END PRIVATE KEY-----'
  let calls=0
  const store=await trustedStore({...env,FIREBASE_SERVICE_ACCOUNT:JSON.stringify({project_id:env.FIREBASE_PROJECT_ID,client_email:'test-only@growthmark-c0e9c.iam.gserviceaccount.com',private_key:pem})},async(url,init)=>{
    calls++;assert.equal(url,'https://oauth2.googleapis.com/token')
    const parts=init.body.get('assertion').split('.'),claims=JSON.parse(Buffer.from(parts[1],'base64url').toString())
    assert.equal(claims.scope,'https://www.googleapis.com/auth/datastore');assert.equal(claims.aud,url);assert.equal(claims.exp-claims.iat,300)
    assert.equal(await crypto.subtle.verify('RSASSA-PKCS1-v1_5',pair.publicKey,Buffer.from(parts[2],'base64url'),new TextEncoder().encode(parts[0]+'.'+parts[1])),true)
    return Response.json({access_token:'test-token-not-real'})
  })
  assert.equal(calls,1);assert.equal(store.projectId,'growthmark-c0e9c')
})
test('workspace bootstrap retries only contention, uses stable UID and stops after three attempts',async()=>{
  for(const [status,count]of [[409,3],[403,1]]){
    const reads=[];await assert.rejects(provisionNewWorkspace({get:async path=>{reads.push(path);throw Object.assign(new Error('Test response'),{status})}},{uid:'stable-owner',email:'fixture@example.test',emailVerified:true,createdAt:Date.now()},{ownerName:'Owner',businessName:'Business'},{newAccountsAfter:0}))
    assert.equal(reads.length,count);assert.ok(reads.every(path=>path==='workspaces/stable-owner'))
  }
})
