// Read-only business-data review of the latest disposable browser fixture.
import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {writeFile,mkdir} from 'node:fs/promises'
import {firestoreRest} from '../../server/firestore-rest.mjs'
const origin='http://127.0.0.1:5175',auth='http://127.0.0.1:9299',project='demo-growthmark-invoice-preview',out='tests/security/results/browser-release'
let browser,page;const results=[]
try{
  await mkdir(out,{recursive:true})
  // Consumed verification codes disappear from the emulator OOB list; select a
  // completed QA workspace instead. This privileged fixture read is loopback only.
  const store=firestoreRest({projectId:project,accessToken:'owner',baseUrl:'http://127.0.0.1:8380/v1'})
  const workspaces=(await store.list('workspaces')).filter(w=>w.data.name==='QA A Business').sort((a,b)=>b.updateTime.localeCompare(a.updateTime));let email
  for(const workspace of workspaces){if((await store.get('workspaces/'+workspace.id+'/invoiceCounters/main')).data?.lastSequence>=48){email=(await store.get('users/'+workspace.id)).data.email;break}}
  assert.ok(email)
  browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',locale:'en-IN',timezoneId:'Asia/Kolkata'})
  await context.route('**/*',route=>{const u=new URL(route.request().url());return u.protocol==='blob:'||u.protocol==='data:'||u.hostname==='127.0.0.1'&&['5175','9299','8380'].includes(u.port)?route.continue():route.abort()})
  page=await context.newPage();await page.goto(origin);await page.getByLabel('Email address',{exact:true}).fill(email);await page.locator('input[type=password]').fill('Isolated-QA-only-2026!');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.locator('#workspace-navigation').waitFor()
  for(const width of [1440,768,390]){
    await page.setViewportSize({width,height:width===390?844:1000})
    for(const dark of [false,true]){
      await page.goto(origin+'/#dashboard');await page.locator('#dashboard').waitFor();const current=await page.locator('html').evaluate(el=>el.classList.contains('dark'));if(current!==dark)await page.getByRole('button',{name:dark?'Switch to dark mode':'Switch to light mode',exact:true}).click()
      const fit=await page.locator('.welcome-copy').evaluate(el=>{const c=el.getBoundingClientRect(),p=el.parentElement.getBoundingClientRect();return {scroll:el.scrollWidth,width:el.clientWidth,right:c.right,parentRight:p.right}})
      assert.ok(fit.scroll<=fit.width+1,JSON.stringify(fit));assert.ok(fit.right<=fit.parentRight+1,JSON.stringify(fit))
      if(width===390)assert.ok(await page.locator('#workspace-navigation').evaluate(el=>el.getBoundingClientRect().right<=1))
      await page.screenshot({path:`${out}/visual-dashboard-${width}-${dark?'dark':'light'}.png`,fullPage:true,animations:'disabled'})
      for(const id of ['clients','projects','tasks','quotations','invoices','payments','retainers','reports','business','settings']){
        await page.goto(origin+'/#'+id);await page.locator('main').waitFor();await page.getByText('Checking your records.',{exact:false}).waitFor({state:'hidden'}).catch(()=>{})
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`${id} overflows ${width} ${dark}`)
      }
      await page.goto(origin+'/#invoices');const row=page.getByRole('row').filter({hasText:'QA-INV-000048'});await row.getByRole('button',{name:'Open / preview',exact:true}).click();await page.locator('.invoice-paper').waitFor()
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
      await page.screenshot({path:`${out}/visual-invoice-${width}-${dark?'dark':'light'}.png`,fullPage:true,animations:'disabled'})
      results.push({width,theme:dark?'dark':'light',allModulePages:'passed',invoicePreview:'passed',heroBounds:'passed'});console.log('PASS visual matrix',width,dark?'dark':'light')
    }
  }
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('button',{name:'Forgot password?',exact:true}).click();await page.getByLabel('Email address',{exact:true}).fill(email);await page.getByRole('button',{name:'Send reset link',exact:true}).click();await page.getByText('If this email has an account,',{exact:false}).waitFor()
  const codes=(await(await fetch(auth+'/emulator/v1/projects/'+project+'/oobCodes')).json()).oobCodes;assert.ok(codes.some(c=>c.email===email&&c.requestType==='PASSWORD_RESET'));results.push({passwordReset:'passed'});console.log('PASS browser password reset request')
}catch(error){results.push({failed:error.message});console.error(error.stack);if(page)await page.screenshot({path:out+'/visual-failure.png',fullPage:true,animations:'disabled'}).catch(()=>{});process.exitCode=1}
finally{await writeFile(out+'/visual-report.json',JSON.stringify(results,null,2));await browser?.close()}
