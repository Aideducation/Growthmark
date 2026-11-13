import type {Auth} from 'firebase/auth'
import type {OnboardingInput} from './contracts'
export async function provisionWorkspace(auth:Auth,input:OnboardingInput){
  const user=auth.currentUser
  if(!user?.emailVerified)throw new Error('Verify your email before creating a workspace.')
  const token=await user.getIdToken()
  if(auth.currentUser?.uid!==user.uid)throw new Error('Your account changed. Try again.')
  const response=await fetch('/api/workspace',{method:'POST',signal:AbortSignal.timeout(30000),credentials:'same-origin',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(input)})
  const result=await response.json().catch(()=>null)
  if(!response.ok||!['ready','inventory-required'].includes(result?.status))throw new Error(result?.error??'Workspace provisioning is unavailable. No local fallback was created.')
  if(auth.currentUser?.uid!==user.uid)throw new Error('Your account changed. Reopen your workspace.')
  return result.status as 'ready'|'inventory-required'
}
