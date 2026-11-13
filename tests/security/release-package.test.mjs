import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import {build} from 'esbuild'
test('final release rules retain every candidate protection',async()=>{
  const a=await readFile('firestore.invoice-workflow.candidate.rules','utf8'),b=await readFile('firestore.release.rules','utf8')
  const normalized=s=>s.replace(/\/\/[^\n]*/g,'').replace(/\s+/g,'')
  assert.equal(normalized(a),normalized(b))
  for(const file of ['firebase.emulator.json','firebase.invoice-preview.json','firebase.release.json'])assert.equal(JSON.parse(await readFile(file,'utf8')).firestore.rules,'firestore.release.rules')
})
test('Cloudflare Pages Function bundles without Node or frontend credentials',async()=>{
  const result=await build({entryPoints:['functions/api/workspace.js'],bundle:true,platform:'browser',format:'esm',write:false})
  assert.ok(result.outputFiles[0].text.includes('onRequest'))
  const files=await readdir('dist/assets');let app='';for(const file of files.filter(f=>f.endsWith('.js')))app+=await readFile('dist/assets/'+file,'utf8')
  assert.ok(!app.includes('FIREBASE_SERVICE_ACCOUNT'));assert.ok(!app.includes('-----BEGIN PRIVATE KEY-----'))
})
