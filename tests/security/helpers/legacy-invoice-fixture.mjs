// Historical fixture builder only. This is not an application creation route.
import { doc, writeBatch, serverTimestamp, Timestamp } from 'firebase/firestore'
import { calculateInvoice } from '../../../src/features/workspace/invoices/model.ts'
import { requireEmulators } from '../helpers.mjs'

export function legacyInvoiceBatch(db, uid, draft, clientId, id) {
  requireEmulators()
  const head=doc(db,'workspaces',uid,'invoices',id),batch=writeBatch(db),totals=calculateInvoice(draft)
  const metadata=()=>({schemaVersion:1,workspaceId:uid,ownerId:uid,revision:1,createdAt:serverTimestamp(),updatedAt:serverTimestamp()})
  const {agency,client,...content}=draft
  batch.set(head,{...metadata(),clientId,projectId:null,title:draft.title,state:'draft',issueAt:Timestamp.fromDate(new Date(draft.date+'T00:00:00Z')),dueAt:draft.due?Timestamp.fromDate(new Date(draft.due+'T00:00:00Z')):null,terms:draft.terms,notes:draft.notes})
  batch.set(doc(head,'configuration','snapshot'),{...metadata(),agencyJson:JSON.stringify(agency),clientJson:JSON.stringify(client),contentJson:JSON.stringify(content)})
  const put=(id,description,amount)=>batch.set(doc(head,'items',id),{...metadata(),description,quantityMilli:1000,unitPriceMinor:amount,taxRateBps:0,discountBps:0})
  draft.lines.forEach((line,index)=>put('advanced-'+line.id,`${line.name}${line.description?' — '+line.description:''}`.slice(0,2000),totals.lines[index].total))
  if(totals.charges)put('advanced-charges','Additional non-taxable charges',totals.charges)
  return batch
}
export async function seedLegacyInvoice(env, uid, draft, clientId, id) {
  requireEmulators()
  await env.withSecurityRulesDisabled(ctx=>legacyInvoiceBatch(ctx.firestore(),uid,draft,clientId,id).commit())
  return id
}
