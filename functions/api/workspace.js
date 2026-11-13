import {verifyFirebaseUser,trustedStore} from '../../server/firebase-server.mjs'
import {onboardingInput,provisionNewWorkspace} from '../../server/workspace-provisioning.mjs'
const reply=(status,data)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})
export function workspaceHandler({verify=verifyFirebaseUser,store=trustedStore}={}){
  return async ({request,env})=>{
    if(request.method!=='POST')return reply(405,{error:'POST required.'})
    if(request.headers.get('Origin')!==new URL(request.url).origin)return reply(403,{error:'Same-origin request required.'})
    if(!request.headers.get('Content-Type')?.startsWith('application/json'))return reply(400,{error:'JSON required.'})
    const authorization=request.headers.get('Authorization')
    if(!authorization?.startsWith('Bearer '))return reply(401,{error:'Sign in and verify your email first.'})
    if(env.WORKSPACE_PROVISIONING_ENABLED!=='true'||!Number.isFinite(Date.parse(env.WORKSPACE_NEW_ACCOUNTS_AFTER)))return reply(503,{error:'Workspace provisioning is awaiting release configuration. No fallback workspace was created.'})
    try{
      // Bound the actual streamed body, including requests with no Content-Length.
      let size=0,chunks=[];const reader=request.body?.getReader();if(!reader)return reply(400,{error:'Names required.'})
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2048){await reader.cancel();return reply(413,{error:'Request too large.'})}chunks.push(value)}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
      const input=onboardingInput(JSON.parse(new TextDecoder().decode(bytes)))
      const user=await verify(authorization.slice(7),env)
      const result=await provisionNewWorkspace(await store(env),user,input,{newAccountsAfter:Date.parse(env.WORKSPACE_NEW_ACCOUNTS_AFTER)})
      return reply(200,result)
    }catch{return reply(409,{error:'Workspace setup could not be safely completed. Retry once; if it continues, contact support. Existing workspaces without counters require historical inventory review.'})}
  }
}
export const onRequest=workspaceHandler()
