// Cloudflare server-only credentials. No Admin SDK, key file or browser environment.
import {firestoreRest} from './firestore-rest.mjs'
const project='growthmark-c0e9c'
const b64url=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')
const json64=value=>b64url(new TextEncoder().encode(JSON.stringify(value)))
export async function verifyFirebaseUser(token,env,fetcher=fetch,now=Math.floor(Date.now()/1000)){
  if(env.FIREBASE_PROJECT_ID!==project||!env.FIREBASE_WEB_API_KEY||typeof token!=='string'||token.length>8192)throw new Error('Authentication configuration unavailable.')
  let claims,header
  try{const parts=token.split('.');if(parts.length!==3)throw 0;const read=s=>JSON.parse(atob(s.replaceAll('-','+').replaceAll('_','/')));header=read(parts[0]);claims=read(parts[1])}catch{throw new Error('Invalid authentication token.')}
  if(header.alg!=='RS256'||typeof header.kid!=='string'||claims.aud!==project||claims.iss!=='https://securetoken.google.com/'+project
    ||typeof claims.sub!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(claims.sub)||!Number.isFinite(claims.exp)||claims.exp<=now
    ||!Number.isFinite(claims.iat)||claims.iat>now+60||!Number.isFinite(claims.auth_time)||claims.auth_time>now+60
    ||claims.email_verified!==true||!['password','google.com'].includes(claims.firebase?.sign_in_provider))throw new Error('Verified authentication required.')
  // Google verifies the ID token's signature/project/session. Decoding alone never authorizes.
  const response=await fetcher('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+encodeURIComponent(env.FIREBASE_WEB_API_KEY),{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:token})})
  if(!response.ok)throw new Error('Authentication could not be verified.')
  const users=(await response.json()).users,u=users?.length===1?users[0]:null
  if(!u||u.localId!==claims.sub||u.email!==claims.email||u.emailVerified!==true||u.disabled===true||Number(u.validSince??0)>claims.auth_time)throw new Error('Verified active account required.')
  return {uid:u.localId,email:u.email,emailVerified:true,createdAt:Number(u.createdAt)}
}
export async function trustedStore(env,fetcher=fetch){
  if(env.FIREBASE_PROJECT_ID!==project||env.FIRESTORE_EMULATOR_HOST||env.FIREBASE_AUTH_EMULATOR_HOST)throw new Error('Invalid server project configuration.')
  let service
  try{service=JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)}catch{throw new Error('Workspace provisioning is not configured. Contact support.')}
  if(service.project_id!==project||!service.client_email?.endsWith('@'+project+'.iam.gserviceaccount.com')||typeof service.private_key!=='string')throw new Error('Invalid server credential configuration.')
  const now=Math.floor(Date.now()/1000),message=json64({alg:'RS256',typ:'JWT'})+'.'+json64({iss:service.client_email,scope:'https://www.googleapis.com/auth/datastore',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+300})
  const der=Uint8Array.from(atob(service.private_key.replace(/-----[^-]+-----|\s/g,'')),c=>c.charCodeAt(0))
  const key=await crypto.subtle.importKey('pkcs8',der,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign'])
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(message))
  const result=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:message+'.'+b64url(new Uint8Array(signature))})})
  if(!result.ok)throw new Error('Trusted provisioning authorization unavailable.')
  const token=await result.json();if(!token.access_token)throw new Error('Trusted authorization unavailable.')
  return firestoreRest({projectId:project,accessToken:token.access_token,fetcher})
}
