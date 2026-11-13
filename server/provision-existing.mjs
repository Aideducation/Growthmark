// Trusted operator core only. Default inventory is read-only. Never reachable by HTTP.
const validId=uid=>typeof uid==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(uid)
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value
async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(value)))))).map(x=>x.toString(16).padStart(2,'0')).join('')}
export async function inventoryWorkspace(store,uid,externalReferences=[]){
  if(!validId(uid)||!Array.isArray(externalReferences))throw new Error('Invalid reviewed inventory input.')
  const root='workspaces/'+uid,workspace=await store.get(root),profile=await store.get('users/'+uid),counter=await store.get(root+'/invoiceCounters/main'),preferences=await store.get(root+'/settings/invoice')
  if(workspace.data?.ownerId!==uid||profile.data?.userId!==uid||profile.data.workspaceId!==uid)throw new Error('Workspace identity requires review.')
  if(preferences.exists&&(preferences.data.ownerId!==uid||preferences.data.workspaceId!==uid||typeof preferences.data.invoicePrefix!=='string'||!/^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/.test(preferences.data.invoicePrefix)))throw new Error('Review structured invoice prefix settings before provisioning.')
  const proposedPrefix=preferences.exists?preferences.data.invoicePrefix:((workspace.data.name??'').replace(/[^A-Za-z0-9 ]/g,' ').trim().split(/\s+/).map(w=>w[0]).join('').slice(0,10).toUpperCase()||'INV')+'-INV'
  const rows=(await store.list(root+'/invoices')).sort((a,b)=>a.id.localeCompare(b.id)),bindings=(await store.list(root+'/invoiceAllocations')).sort((a,b)=>a.id.localeCompare(b.id)),snapshots=[],seen=new Map()
  let baseline=0
  const reference=(value,id)=>{
    if(typeof value!=='string'||!value)return
    const match=/^([A-Za-z0-9][A-Za-z0-9-]{0,19})-([0-9]+)$/.exec(value)
    if(!match)throw new Error('Ambiguous historical invoice reference in '+id+'.')
    const n=Number(match[2]);if(!Number.isSafeInteger(n)||n<1||n>=1e9)throw new Error('Invalid historical sequence in '+id+'.')
    const key=match[1].toUpperCase()+'-'+n
    if(seen.has(key)&&seen.get(key)!==id)throw new Error('Duplicate historical invoice reference: '+key+'.')
    seen.set(key,id);baseline=Math.max(baseline,n)
  }
  const inspect=(data,id)=>{
    for(const key of Object.keys(data))if(/number|reference|sequence/i.test(key)&&!['invoiceNumber','invoiceNo','historicalReference','reference','number','numberSequence','numberPrefix'].includes(key))throw new Error('Unrecognized historical numbering field in '+id+'.')
    for(const key of ['invoiceNumber','invoiceNo','historicalReference','reference','number'])if(Object.hasOwn(data,key)&&data[key]!==null&&data[key]!==''){
      if(typeof data[key]!=='string')throw new Error('Unrecognized historical number in '+id+'.');reference(data[key],id)
    }
    if(Object.hasOwn(data,'numberSequence')||Object.hasOwn(data,'numberPrefix')){
      if(!Number.isSafeInteger(data.numberSequence)||data.numberSequence<1||data.numberSequence>=1e9||typeof data.numberPrefix!=='string')throw new Error('Invalid number components in '+id+'.')
      reference(data.numberPrefix+'-'+data.numberSequence,id)
    }
    if(Object.hasOwn(data,'_allocation')){
      const a=data._allocation
      if(!a||a.version!==1||a.invoiceId!==id||!validId(a.requestId)||Object.keys(a).length!==3||!data.numberPrefix||!data.numberSequence)throw new Error('Historical allocation marker needs reconciled header numbers in '+id+'.')
    }
  }
  for(const row of rows){
    if(row.missing||row.data.ownerId!==uid||row.data.workspaceId!==uid)throw new Error('Orphan or foreign invoice requires review: '+row.id+'.')
    const headFields=['schemaVersion','workspaceId','ownerId','createdAt','updatedAt','revision','clientId','projectId','title','state','issueAt','dueAt','terms','notes','manualStatus','numberPrefix','numberSequence','allocation','itemIds','invoiceNumber','invoiceNo','historicalReference','reference','number']
    if(Object.keys(row.data).some(key=>!headFields.includes(key)))throw new Error('Unrecognized historical invoice schema in '+row.id+'.')
    inspect(row.data,row.id)
    const snap=await store.get(root+'/invoices/'+row.id+'/configuration/snapshot');snapshots.push({id:row.id,...snap})
    if(snap.exists){
      if(snap.data.ownerId!==uid||snap.data.workspaceId!==uid)throw new Error('Snapshot ownership requires review.')
      let content;try{content=JSON.parse(snap.data.contentJson)}catch{throw new Error('Malformed historical snapshot in '+row.id+'.')}
      if(!content||typeof content!=='object'||Array.isArray(content))throw new Error('Invalid historical snapshot.')
      const contentFields=['version','title','date','due','currency','priceMode','gstMode','gstEnabled','discountKind','discount','charges','notes','terms','methods','lines','_allocation','invoiceNumber','invoiceNo','historicalReference','reference','number','numberPrefix','numberSequence']
      if(Object.keys(content).some(key=>!contentFields.includes(key)))throw new Error('Unrecognized historical snapshot schema in '+row.id+'.')
      inspect({...content,...(content._allocation?{numberPrefix:row.data.numberPrefix,numberSequence:row.data.numberSequence}:{})},row.id)
    }
    if(row.data.allocation){
      const a=row.data.allocation,b=bindings.find(b=>b.id===a.requestId)?.data.identity
      if(a.version!==1||Object.keys(a).length!==6||!validId(a.requestId)||a.workspaceId!==uid||a.invoiceId!==row.id||a.prefix!==row.data.numberPrefix||a.sequence!==row.data.numberSequence||JSON.stringify(canonical(a))!==JSON.stringify(canonical(b)))throw new Error('Protected allocation history requires reconciliation.')
    }
  }
  for(const binding of bindings)if(!rows.some(row=>row.id===binding.data.identity?.invoiceId&&row.data.allocation?.requestId===binding.id))throw new Error('Orphan request binding requires review.')
  for(const ext of externalReferences){if(!ext||!validId(ext.id)||typeof ext.reference!=='string'||!ext.reference)throw new Error('Invalid external history.');reference(ext.reference,ext.id)}
  if(counter.exists){const c=counter.data;if(c.ownerId!==uid||c.workspaceId!==uid||c.schemaVersion!==1||!Number.isSafeInteger(c.revision)||c.revision<1||c.initializationVersion!==1||!Number.isSafeInteger(c.baselineSequence)||c.baselineSequence<0||!Number.isSafeInteger(c.lastSequence)||c.lastSequence<Math.max(c.baselineSequence,baseline)||c.lastSequence>=1e9||(c.lastSequence>c.baselineSequence&&!rows.some(row=>row.id===c.lastInvoiceId&&row.data.numberSequence===c.lastSequence)))throw new Error('Existing counter is inconsistent with history; refusing automatic repair.')}
  return {version:1,projectId:store.projectId,workspaceId:uid,baseline,invoiceCount:rows.length,proposedPrefix,counterExists:counter.exists,inventoryDigest:await digest({workspace,profile,counter,preferences,rows,snapshots,bindings,externalReferences})}
}
export async function provisionExistingWorkspace(store,uid,review){
  if(!validId(uid)||review?.complete!==true||!review.reviewer?.trim()||review.workspaceId!==uid||review.projectId!==store.projectId||!Array.isArray(review.externalReferences)||!/^[a-f0-9]{64}$/.test(review.inventoryDigest??''))throw new Error('Complete signed-off workspace inventory required.')
  const path='accountAccess/'+uid,root='workspaces/'+uid,nonce=crypto.randomUUID(),tx=await store.begin()
  let original,lockVersion,locked=false
  try{
    original=await store.get(path,tx);const counter=await store.get(root+'/invoiceCounters/main',tx),workspace=await store.get(root,tx)
    if(counter.exists)throw new Error('Counter already exists; refusing overwrite.')
    if(workspace.data?.ownerId!==uid||original.exists&&(original.data.userId!==uid||original.data.status!=='active'))throw new Error('Suspended, locked or invalid workspace; no provisioning.')
    const frozen=await store.commit([{path,data:{...(original.data??{}),userId:uid,status:'suspended',provisioningLock:nonce},...(original.exists?{updateTime:original.updateTime}:{})}],tx);locked=true;lockVersion=frozen.writeResults[0].updateTime
    const report=await inventoryWorkspace(store,uid,review.externalReferences)
    if(report.inventoryDigest!==review.inventoryDigest)throw new Error('Inventory changed since review. Counter was not initialized.')
    const finalTx=await store.begin()
    try{
      const lock=await store.get(path,finalTx),current=await store.get(root+'/invoiceCounters/main',finalTx),ws=await store.get(root,finalTx),preferences=await store.get(root+'/settings/invoice',finalTx)
      if(lock.data?.provisioningLock!==nonce||lock.updateTime!==lockVersion||lock.data.status!=='suspended'||current.exists||ws.data?.ownerId!==uid)throw new Error('Provisioning lock or ownership changed.')
      await store.commit([
        {path:root+'/invoiceCounters/main',data:{schemaVersion:1,workspaceId:uid,ownerId:uid,revision:1,initializationVersion:1,baselineSequence:report.baseline,lastSequence:report.baseline,lastInvoiceId:null},timestamps:['createdAt','updatedAt']},
        ...(!preferences.exists?[{path:root+'/settings/invoice',data:{schemaVersion:1,workspaceId:uid,ownerId:uid,revision:1,invoicePrefix:report.proposedPrefix,quotationPrefix:'QUO',paymentTermsDays:14,footer:'',thankYouMessage:'',defaultTaxBps:0,defaultDiscountBps:0},timestamps:['createdAt','updatedAt']}]:[]),
        original.exists?{path,data:original.data,updateTime:lock.updateTime}:{path,delete:true,updateTime:lock.updateTime},
      ],finalTx)
      locked=false;return {...report,status:'initialized',reviewer:review.reviewer.trim()}
    }catch(error){await store.rollback(finalTx).catch(()=>{});throw error}
  }catch(error){await store.rollback(tx).catch(()=>{});throw error}
  finally{
    if(locked){const lock=await store.get(path);if(lock.data?.provisioningLock===nonce&&lock.updateTime===lockVersion&&lock.data.status==='suspended')await store.commit([original.exists?{path,data:original.data,updateTime:lock.updateTime}:{path,delete:true,updateTime:lock.updateTime}])}
  }
}
