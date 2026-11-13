// Standard headless application tests. Never attaches to a user's browser/profile.
// Every network request is restricted to the three disposable preview loopback ports.
import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {firestoreRest} from '../../server/firestore-rest.mjs'
import {inventoryWorkspace,provisionExistingWorkspace} from '../../server/provision-existing.mjs'
const origin='http://127.0.0.1:5175',project='demo-growthmark-invoice-preview',authOrigin='http://127.0.0.1:9299'
const results=[],errors=[],stamp=Date.now(),password='Isolated-QA-only-2026!'
let browser,context,page
const output='tests/security/results/browser-release'
const store=firestoreRest({projectId:project,accessToken:'owner',baseUrl:'http://127.0.0.1:8380/v1'})
const visible=locator=>locator.first().waitFor({state:'visible',timeout:30000})
async function check(name,action){await action();results.push({name,result:'passed'});console.log('PASS',name)}
async function navigate(id){await page.goto(origin+'/#'+id);await visible(page.locator('main'));await page.getByText('Checking your records.',{exact:false}).waitFor({state:'hidden'}).catch(()=>{});if(id==='invoices'&&await page.getByRole('button',{name:'All invoices',exact:true}).isVisible())await page.getByRole('button',{name:'All invoices',exact:true}).click();assert.equal(new URL(page.url()).hash,'#'+id)}
async function modalSave(){await page.getByRole('dialog').getByRole('button',{name:'Save record',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'})}
async function login(p,email){await p.getByLabel('Email address',{exact:false}).fill(email);await p.getByLabel('Password',{exact:false}).fill(password);await p.getByRole('button',{name:'Sign in',exact:true}).click();await visible(p.locator('#workspace-navigation'))}
async function register(p,label){
  const email=`release-${label}-${stamp}@example.test`.toLowerCase()
  await p.goto(origin);await visible(p.getByRole('button',{name:'Create an account',exact:true}));await p.getByRole('button',{name:'Create an account',exact:true}).click()
  await p.getByLabel('Full name',{exact:false}).fill('QA '+label);await p.getByLabel('Email address',{exact:false}).fill(email);await p.locator('input[type="password"]').fill(password);await p.getByRole('button',{name:'Create account',exact:true}).click()
  await visible(p.getByRole('heading',{name:'Check your email',exact:true}));assert.equal(await p.locator('#workspace-navigation').count(),0)
  let code;const deadline=Date.now()+12000
  while(!code&&Date.now()<deadline){const {oobCodes}=await(await fetch(authOrigin+'/emulator/v1/projects/'+project+'/oobCodes')).json();code=oobCodes.findLast(c=>c.email===email&&c.requestType==='VERIFY_EMAIL');if(!code)await new Promise(resolve=>setTimeout(resolve,100))}
  assert.ok(code)
  const verified=await fetch(authOrigin+'/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-emulator-only',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({oobCode:code.oobCode})});assert.equal(verified.status,200)
  await p.getByRole('button',{name:/verified my email/}).click();await visible(p.getByRole('heading',{name:'Make this space yours'}))
  await p.getByLabel('Owner name',{exact:false}).fill('QA '+label);await p.getByLabel('Business or agency name',{exact:false}).fill('QA '+label+' Business');await p.getByRole('button',{name:'Open my workspace',exact:true}).click();await visible(p.locator('#workspace-navigation'))
  const uid=await p.evaluate(async()=>{const {auth,firebaseApp,isEmulatorMode}=await import('/src/services/firebase.ts');if(!isEmulatorMode||firebaseApp.options.projectId!=='demo-growthmark-invoice-preview'||auth.emulatorConfig?.port!==9299)throw Error('Isolated preview required');return auth.currentUser.uid})
  return {uid,email}
}
async function newContext(){
  const c=await browser.newContext({viewport:{width:1440,height:1000},locale:'en-IN',timezoneId:'Asia/Kolkata',acceptDownloads:true})
  c.on('page',p=>p.on('dialog',dialog=>dialog.accept())) // Only fixture-app editor confirmations.
  await c.route('**/*',route=>{const u=new URL(route.request().url());return u.protocol==='data:'||u.protocol==='blob:'||(u.hostname==='127.0.0.1'&&['5175','9299','8380'].includes(u.port))?route.continue():route.abort()})
  return c
}
try{
  await mkdir(output,{recursive:true})
  assert.equal((await fetch(origin)).status,200)
  browser=await chromium.launch({channel:'chrome',headless:true})
  context=await newContext();page=await context.newPage();page.on('pageerror',e=>errors.push(e.message))
  let account,clientId,invoiceId,reference
  await check('Email/password registration, real emulator email verification and onboarding',async()=>{account=await register(page,'A')})
  await check('All eleven sidebar pages open and light/dark theme survives refresh',async()=>{
    assert.equal(await page.locator('html').evaluate(el=>el.classList.contains('dark')),false)
    for(const id of ['dashboard','clients','projects','tasks','quotations','invoices','payments','retainers','reports','business','settings'])await navigate(id)
    await navigate('dashboard');await page.screenshot({path:output+'/desktop-light.png',fullPage:true})
    await page.getByRole('button',{name:'Switch to dark mode',exact:true}).first().click();await page.reload();await visible(page.locator('#workspace-navigation'));assert.equal(await page.locator('html').evaluate(el=>el.classList.contains('dark')),true)
    await page.screenshot({path:output+'/desktop-dark.png',fullPage:true});await page.getByRole('button',{name:'Switch to light mode',exact:true}).first().click()
  })
  await check('Client creation and editing',async()=>{
    await navigate('clients');await page.getByRole('button',{name:'Add client',exact:true}).click();await page.getByRole('dialog').getByLabel('Client name',{exact:false}).fill('QA Release Client');await modalSave()
    await page.getByRole('button',{name:'Edit QA Release Client',exact:true}).click();await page.getByRole('dialog').getByLabel('Company',{exact:false}).fill('QA Release Company');await modalSave()
    const clients=await store.list('workspaces/'+account.uid+'/clients');assert.equal(clients.length,1);clientId=clients[0].id;assert.equal(clients[0].data.company,'QA Release Company')
  })
  await check('Project and task workflows',async()=>{
    await navigate('projects');await page.getByRole('button',{name:'Add project',exact:true}).click();let d=page.getByRole('dialog');await d.getByLabel('Client',{exact:false}).selectOption(clientId);await d.getByLabel('Project name',{exact:false}).fill('QA Release Project');await d.getByLabel('Budget',{exact:false}).fill('500');await modalSave()
    const projects=await store.list('workspaces/'+account.uid+'/projects');assert.equal(projects.length,1)
    await navigate('tasks');await page.getByRole('button',{name:'Add task',exact:true}).click();d=page.getByRole('dialog');await d.getByLabel('Client (optional)',{exact:false}).selectOption(clientId);await d.getByLabel('Project (optional)',{exact:false}).selectOption(projects[0].id);await d.getByLabel('Task title',{exact:false}).fill('QA Release Task');await modalSave()
    await page.getByRole('button',{name:'Edit QA Release Task',exact:true}).click();await page.getByRole('dialog').getByLabel('Status',{exact:false}).selectOption('completed');await modalSave();assert.equal((await store.list('workspaces/'+account.uid+'/tasks'))[0].data.status,'completed')
  })
  await check('Quotation creation, service calculation and actual PDF download',async()=>{
    await navigate('quotations');await page.getByRole('button',{name:'Add quotation draft',exact:true}).click();let d=page.getByRole('dialog');await d.getByLabel('Client',{exact:false}).selectOption(clientId);await d.getByLabel('Document title',{exact:false}).fill('QA Quotation');await d.getByLabel('Document date',{exact:false}).fill('2026-11-12');await modalSave()
    await page.getByRole('button',{name:'Add service',exact:true}).click();d=page.getByRole('dialog');await d.getByLabel('Description',{exact:false}).fill('QA Consulting');await d.getByLabel('Unit price',{exact:false}).fill('100');await d.getByRole('button',{name:'Save service',exact:true}).click();await d.waitFor({state:'hidden'})
    const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:/Download.*PDF/}).click();const download=await downloadPromise;await download.saveAs(output+'/quotation.pdf');assert.equal((await readFile(output+'/quotation.pdf')).subarray(0,4).toString(),'%PDF')
  })
  await check('Private Agency Profile, prefix and original payment settings',async()=>{
    await navigate('settings');const agency=page.locator('section[aria-label="Agency Profile"]');await agency.getByLabel('Agency name',{exact:false}).fill('QA Release Agency');await agency.getByLabel('Invoice reference prefix',{exact:false}).fill('QA-INV');await agency.getByLabel('Enable UPI',{exact:false}).selectOption('true');await agency.getByLabel('UPI ID',{exact:false}).fill('original@bank');await agency.getByLabel('Payment instructions',{exact:false}).fill('Original QA invoice instructions');await agency.getByRole('button',{name:'Save agency profile',exact:true}).click();await visible(agency.getByText('Agency profile saved privately.',{exact:false}))
  })
  await check('Historical invoice fixture is inventoried before trusted local counter provisioning',async()=>{
    const root='workspaces/'+account.uid,agency=JSON.parse((await store.get(root+'/settings/agency')).data.profileJson)
    const draft={version:1,title:'QA Historical Invoice',date:'2026-11-12',due:'',currency:'INR',priceMode:'exclusive',gstMode:'split',gstEnabled:false,discountKind:'percent',discount:'0',charges:'0',notes:'Historical fixture',terms:'',methods:['upi'],lines:[{id:'legacy',name:'Historical service',description:'',quantity:'1',unit:'service',rate:'100',discountKind:'percent',discount:'0',gst:'0'}]}
    const meta={schemaVersion:1,workspaceId:account.uid,ownerId:account.uid,revision:1},client={name:'QA Release Client',company:'QA Release Company',contact:'',email:'',phone:'',whatsapp:'',address:'',gstin:''}
    await store.commit([{path:root+'/invoices/qa-historical',data:{...meta,clientId,projectId:null,title:draft.title,state:'draft',issueAt:{$timestamp:'2026-11-12T00:00:00Z'},dueAt:null,terms:'',notes:draft.notes,numberPrefix:'HIST',numberSequence:47},timestamps:['createdAt','updatedAt']},{path:root+'/invoices/qa-historical/configuration/snapshot',data:{...meta,agencyJson:JSON.stringify(agency),clientJson:JSON.stringify(client),contentJson:JSON.stringify(draft)},timestamps:['createdAt','updatedAt']},{path:root+'/invoices/qa-historical/items/advanced-legacy',data:{...meta,description:'Historical service',quantityMilli:1000,unitPriceMinor:10000,taxRateBps:0,discountBps:0},timestamps:['createdAt','updatedAt']}])
    const inventory=await inventoryWorkspace(store,account.uid);assert.equal(inventory.baseline,47)
    await provisionExistingWorkspace(store,account.uid,{...inventory,complete:true,reviewer:'Disposable browser fixture',externalReferences:[]})
  })
  await check('Invoice editor calculates GST/discount and confirms a protected allocated number',async()=>{
    await navigate('invoices');await page.getByRole('button',{name:'Create invoice',exact:true}).click()
    const line=page.locator('.invoice-line-editor').first();await line.getByLabel('name',{exact:false}).fill('QA Invoice Service');await line.getByLabel('rate',{exact:false}).fill('100');await line.getByLabel('quantity',{exact:false}).fill('2');await line.getByLabel('GST (%)',{exact:false}).fill('18');await page.getByLabel('GST enabled',{exact:false}).selectOption('true');await page.getByLabel('Overall discount',{exact:true}).fill('10')
    await page.getByRole('button',{name:'Generate Invoice',exact:true}).click();await visible(page.getByText('Invoice saved and numbered:',{exact:false}))
    const invoices=await store.list('workspaces/'+account.uid+'/invoices'),created=invoices.find(row=>row.id!=='qa-historical');assert.ok(created);invoiceId=created.id;assert.equal(created.data.numberSequence,48);reference='QA-INV-000048'
    await visible(page.getByText('Reference: '+reference,{exact:false}));assert.match(await page.locator('.invoice-paper').innerText(),/212\.40/)
    await page.screenshot({path:output+'/invoice-desktop.png',fullPage:true})
  })
  await check('All six manual statuses preserve payment records and allocated identity',async()=>{
    const root='workspaces/'+account.uid,before=(await store.get(root+'/invoices/'+invoiceId)).data.allocation
    for(const value of ['draft','sent','pending','paid','overdue','cancelled']){await page.getByRole('button',{name:'Edit draft',exact:true}).click();await page.getByLabel('Manual status',{exact:false}).selectOption(value);await page.getByRole('button',{name:'Save changes',exact:true}).click();await visible(page.getByRole('button',{name:'Edit draft',exact:true}));assert.equal((await store.get(root+'/invoices/'+invoiceId)).data.manualStatus,value)}
    assert.equal((await store.list(root+'/payments')).length,0);assert.deepEqual((await store.get(root+'/invoices/'+invoiceId)).data.allocation,before)
  })
  await check('Invoice payment override, original reset, PDF and WhatsApp message',async()=>{
    await page.getByRole('button',{name:'Edit draft',exact:true}).click();await page.getByText('Invoice-specific payment details',{exact:true}).click();const details=page.locator('details');await details.getByLabel('UPI ID',{exact:false}).fill('override@bank');await page.getByLabel('upi',{exact:true}).check();await page.getByRole('button',{name:'Save changes',exact:true}).click();await visible(page.getByRole('button',{name:'Edit draft',exact:true}));assert.match(await page.locator('.invoice-paper').innerText(),/override@bank/)
    const dp=page.waitForEvent('download');await page.getByRole('button',{name:'Download PDF',exact:true}).click();await(await dp).saveAs(output+'/invoice.pdf');assert.equal((await readFile(output+'/invoice.pdf')).subarray(0,4).toString(),'%PDF')
    await page.getByRole('button',{name:'Share via WhatsApp',exact:true}).click();const message=await page.getByRole('dialog').getByLabel('Editable message').inputValue();assert.match(message,/QA-INV-000048/);assert.match(message,/DRAFT/)
    await page.evaluate(()=>{window.__qaOpened=[];window.open=(...args)=>{window.__qaOpened.push(args);return null}});await page.getByRole('dialog').getByRole('button',{name:'Open WhatsApp',exact:true}).click();const opened=await page.evaluate(()=>window.__qaOpened[0]);assert.ok(opened[0].startsWith('https://wa.me/'));assert.equal(new URL(opened[0]).searchParams.get('text'),message);assert.equal(opened[2],'noopener,noreferrer')
    await page.getByRole('dialog').getByRole('button',{name:'Close dialog',exact:true}).click()
    await page.getByRole('button',{name:'Edit draft',exact:true}).click();await page.getByText('Invoice-specific payment details',{exact:true}).click();await page.getByRole('button',{name:'Reset to original snapshot',exact:true}).click();await page.getByRole('button',{name:'Save changes',exact:true}).click();await visible(page.getByRole('button',{name:'Edit draft',exact:true}));assert.match(await page.locator('.invoice-paper').innerText(),/original@bank/)
  })
  await check('Owner-recorded manual payment remains append-only and separate from invoice labels',async()=>{
    await navigate('payments');await page.getByRole('button',{name:'Add manual payment',exact:true}).click();const d=page.getByRole('dialog');await d.getByLabel('Client',{exact:false}).selectOption(clientId);await d.getByLabel('Amount received',{exact:false}).fill('50')
    const paidAt=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(Date.now()-120000)).replace(' ','T');await d.getByLabel('Payment date and time',{exact:false}).fill(paidAt);await d.getByLabel('Payment method',{exact:false}).selectOption('cash');await modalSave()
    const payments=await store.list('workspaces/'+account.uid+'/payments');assert.equal(payments.length,1);assert.equal(payments[0].data.amountMinor,5000);assert.equal(await page.getByRole('button',{name:/^Edit /}).count(),0)
  })
  await check('Refresh recovery recognizes the existing protected request without duplicate allocation',async()=>{
    await navigate('invoices')
    const root='workspaces/'+account.uid,head=(await store.get(root+'/invoices/'+invoiceId)).data,before=(await store.get(root+'/invoiceCounters/main')).data.lastSequence
    await page.evaluate(async request=>{const{keepPendingRequest}=await import('/src/features/workspace/invoices/pending-request.ts');keepPendingRequest(sessionStorage,request)},{version:1,ownerId:account.uid,invoiceId,requestId:head.allocation.requestId,submitted:true})
    await page.reload();await visible(page.getByRole('button',{name:'Check pending save',exact:true}));await page.getByRole('button',{name:'Check pending save',exact:true}).click();await visible(page.getByText('Saved invoice recovered.',{exact:false}));assert.equal((await store.get(root+'/invoiceCounters/main')).data.lastSequence,before)
  })
  await check('Historical invoice editing preserves its original number',async()=>{
    await navigate('invoices');await page.getByRole('row').filter({hasText:'QA Historical Invoice'}).getByRole('button',{name:'Open / preview',exact:true}).click();await page.getByRole('button',{name:'Edit draft',exact:true}).click();await page.getByLabel('Notes',{exact:false}).fill('QA legacy edit');await page.getByRole('button',{name:'Save changes',exact:true}).click();await visible(page.getByRole('button',{name:'Edit draft',exact:true}));const head=(await store.get('workspaces/'+account.uid+'/invoices/qa-historical')).data;assert.equal(head.numberSequence,47);assert.equal(head.numberPrefix,'HIST');assert.equal(head.allocation,undefined)
  })
  await check('Eight-item UI limit blocks saving before a write',async()=>{
    await navigate('invoices');await page.getByRole('button',{name:'Create invoice',exact:true}).click()
    for(let i=1;i<8;i++)await page.getByRole('button',{name:'Add service',exact:true}).click()
    assert.equal(await page.getByRole('button',{name:'Add service',exact:true}).isDisabled(),true)
    await page.getByLabel('Additional non-taxable charges',{exact:false}).fill('5');assert.equal(await page.getByRole('button',{name:'Generate Invoice',exact:true}).isDisabled(),true);await visible(page.getByRole('alert').filter({hasText:'eight item records'}))
  })
  await check('Desktop/tablet/mobile layouts, both themes and mobile sidebar navigation',async()=>{
    await navigate('dashboard')
    for(const [width,height]of [[1440,1000],[768,1024],[390,844]]){
      await page.setViewportSize({width,height});for(const dark of [false,true]){const current=await page.locator('html').evaluate(el=>el.classList.contains('dark'));if(current!==dark)await page.getByRole('button',{name:dark?'Switch to dark mode':'Switch to light mode',exact:true}).first().click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:`${output}/layout-${width}-${dark?'dark':'light'}.png`,fullPage:true})}
    }
    await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.locator('#workspace-navigation').getByRole('link',{name:'Invoices',exact:true}).click();await visible(page.getByRole('button',{name:'Create invoice',exact:true}));assert.equal(await page.getByRole('button',{name:'Open navigation',exact:true}).getAttribute('aria-expanded'),'false')
    await page.setViewportSize({width:1440,height:1000})
  })
  await check('Independent second account, same-browser switching and persistent login isolate records',async()=>{
    const cb=await newContext(),pb=await cb.newPage(),b=await register(pb,'B');assert.notEqual(b.uid,account.uid);await pb.goto(origin+'/#clients');await visible(pb.getByRole('button',{name:'Add client',exact:true}));assert.equal(await pb.getByText('QA Release Client',{exact:true}).count(),0)
    const btoken=await pb.evaluate(async()=>{const{auth}=await import('/src/services/firebase.ts');return auth.currentUser.getIdToken()});const denied=await fetch('http://127.0.0.1:8380/v1/projects/'+project+'/databases/(default)/documents/workspaces/'+account.uid+'/invoices/'+invoiceId,{headers:{Authorization:'Bearer '+btoken}});assert.equal(denied.status,403)
    await page.getByRole('button',{name:'Sign out',exact:true}).click();await visible(page.getByRole('button',{name:'Sign in',exact:true}));await login(page,b.email);await navigate('clients');assert.equal(await page.getByText('QA Release Client',{exact:true}).count(),0)
    await page.getByRole('button',{name:'Sign out',exact:true}).click();await visible(page.getByRole('button',{name:'Sign in',exact:true}));await login(page,account.email);await navigate('clients');await visible(page.getByText('QA Release Client',{exact:true}));await page.reload();await visible(page.getByText('QA Release Client',{exact:true}));await cb.close()
  })
  assert.deepEqual(errors,[]);console.log('BROWSER RELEASE CHECKS PASSED',results.length)
}catch(error){results.push({result:'failed',error:error.message});console.error(error.stack);if(page){await page.screenshot({path:output+'/failure.png',fullPage:true}).catch(()=>{});await writeFile(output+'/failure-dom.txt',await page.locator('body').innerText().catch(()=>''))}process.exitCode=1}
finally{await writeFile(output+'/report.json',JSON.stringify({results,pageErrors:errors},null,2));await browser?.close()}
