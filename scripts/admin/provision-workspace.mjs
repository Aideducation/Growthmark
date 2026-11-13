// Explicit operator process. Never imported by frontend/Pages Functions. No key files.
import {readFile} from 'node:fs/promises'
import {firestoreRest} from '../../server/firestore-rest.mjs'
import {inventoryWorkspace,provisionExistingWorkspace} from '../../server/provision-existing.mjs'
const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1]
try{
  const uid=value('--uid'),reviewPath=value('--review'),apply=args.includes('--apply')
  if(!args.includes('--uid')||!args.includes('--review'))throw new Error('Supply --uid UID --review PRIVATE_REVIEW_FILE. Default is read-only inventory.')
  if(apply&&!args.includes('--approved-production-write'))throw new Error('Production writes need separate user approval and --approved-production-write.')
  if(!process.env.GROWTHMARK_PROVISION_ACCESS_TOKEN)throw new Error('Provide a short-lived trusted operator OAuth access token outside the repository. No credential files are accepted.')
  const review=JSON.parse(await readFile(reviewPath,'utf8'))
  if(review.projectId!=='growthmark-c0e9c'||review.workspaceId!==uid)throw new Error('Review project/workspace must match the explicit production target.')
  const store=firestoreRest({projectId:'growthmark-c0e9c',accessToken:process.env.GROWTHMARK_PROVISION_ACCESS_TOKEN})
  const report=apply?await provisionExistingWorkspace(store,uid,review):await inventoryWorkspace(store,uid,review.externalReferences??[])
  console.log(JSON.stringify(report,null,2))
}catch(error){console.error(error.message);process.exitCode=1}
