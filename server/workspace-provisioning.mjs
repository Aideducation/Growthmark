// Trusted core shared by the server endpoint and isolated tests. No frontend imports.
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value)
export function onboardingInput(input){
  if(!input||Object.keys(input).some(k=>!['ownerName','businessName'].includes(k)))throw new Error('Only owner and business names are accepted.')
  for(const key of ['ownerName','businessName'])if(typeof input[key]!=='string'||!input[key].trim()||input[key].trim().length>160)throw new Error('Owner and business names must contain 1–160 characters.')
  return {ownerName:input.ownerName.trim(),businessName:input.businessName.trim()}
}
export async function provisionNewWorkspace(store,user,input,policy={}){
  const stableUser={...user},stableInput={...input},stablePolicy={...policy}
  for(let attempt=1;attempt<=3;attempt++){
    try{return await provisionOnce(store,stableUser,stableInput,stablePolicy)}
    catch(error){if(error.status!==409||attempt===3)throw error;await new Promise(resolve=>setTimeout(resolve,attempt*40+Math.floor(Math.random()*60)))}
  }
}
async function provisionOnce(store,user,input,{newAccountsAfter=Infinity}={}){
  input=onboardingInput(input)
  if(!id(user.uid)||!user.emailVerified||!user.email)throw new Error('Verified account required.')
  const uid=user.uid,root='workspaces/'+uid
  const priorWorkspace=await store.get(root),priorProfile=await store.get('users/'+uid)
  if(!priorWorkspace.exists&&!priorProfile.exists){
    if(!Number.isFinite(newAccountsAfter)||!Number.isFinite(user.createdAt)||user.createdAt<newAccountsAfter)throw new Error('Pre-release account requires historical review.')
    // No owner can write business history while its workspace is absent. Check
    // orphan collections before taking transaction locks, then re-read the root.
    for(const kind of ['clients','projects','tasks','quotations','invoices','payments','settings','invoiceAllocations'])if((await store.list(root+'/'+kind)).length)throw new Error('Existing workspace history requires review.')
  }
  try{
    const workspace=await store.get(root),profile=await store.get('users/'+uid),counter=await store.get(root+'/invoiceCounters/main'),access=await store.get('accountAccess/'+uid)
    if(access.exists&&(access.data.userId!==uid||access.data.status!=='active'))throw new Error('Workspace access is unavailable.')
    if(workspace.exists||profile.exists||counter.exists){
      if(!workspace.exists||!profile.exists||workspace.data.ownerId!==uid||profile.data.userId!==uid||profile.data.workspaceId!==uid)throw new Error('Existing workspace requires trusted review.')
      if(counter.exists&&(counter.data.ownerId!==uid||counter.data.workspaceId!==uid||counter.data.schemaVersion!==1||counter.data.initializationVersion!==1||!Number.isSafeInteger(counter.data.revision)||counter.data.revision<1||!Number.isSafeInteger(counter.data.baselineSequence)||counter.data.baselineSequence<0||!Number.isSafeInteger(counter.data.lastSequence)||counter.data.lastSequence<counter.data.baselineSequence||counter.data.lastSequence>=1e9))throw new Error('Counter requires trusted review.')
      return {status:counter.exists?'ready':'inventory-required'}
    }
    if(priorWorkspace.exists||priorProfile.exists)throw new Error('Workspace changed during provisioning; trusted review required.')
    // Create-only profile + workspace + counter is atomic. No pre-existing history
    // can race in: rules require an existing workspace before any business write.
    const meta={schemaVersion:1,workspaceId:uid,ownerId:uid,revision:1}
    const prefix=input.businessName.replace(/[^A-Za-z0-9 ]/g,' ').trim().split(/\s+/).map(w=>w[0]).join('').slice(0,10).toUpperCase()||'INV'
    await store.commit([
      // Verify access-policy version/absence in the SAME atomic commit, without
      // pessimistic missing-document locks that deadlock simultaneous signups.
      {path:'accountAccess/'+uid,verify:true,...(access.exists?{updateTime:access.updateTime}:{})},
      {path:'users/'+uid,data:{schemaVersion:1,userId:uid,workspaceId:uid,fullName:input.ownerName,email:user.email,phone:'',whatsapp:''},timestamps:['createdAt','updatedAt']},
      {path:root,data:{schemaVersion:1,ownerId:uid,name:input.businessName,currency:'INR',timezone:'Asia/Kolkata',onboarding:'complete'},timestamps:['createdAt','updatedAt']},
      {path:root+'/invoiceCounters/main',data:{...meta,initializationVersion:1,baselineSequence:0,lastSequence:0,lastInvoiceId:null},timestamps:['createdAt','updatedAt']},
      {path:root+'/settings/invoice',data:{...meta,invoicePrefix:prefix==='INV'?'INV':prefix+'-INV',quotationPrefix:'QUO',paymentTermsDays:14,footer:'',thankYouMessage:'',defaultTaxBps:0,defaultDiscountBps:0},timestamps:['createdAt','updatedAt']},
      {path:root+'/settings/business',data:{...meta,name:input.businessName,businessType:'',industry:'',email:user.email,phone:'',whatsapp:'',website:'',street:'',city:'',state:'',country:'India',postalCode:'',gstin:''},timestamps:['createdAt','updatedAt']},
    ])
    return {status:'ready'}
  }catch(error){throw error}
}
