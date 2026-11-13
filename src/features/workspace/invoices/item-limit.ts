import {MAX_PROTECTED_INVOICE_ITEMS} from './allocation-identity.ts'
export function invoiceItemLimitError(lines:number,charges:string,protectedInvoice:boolean):string {
  if(!protectedInvoice)return ''
  const count=lines+(Number(charges)>0?1:0)
  return count>MAX_PROTECTED_INVOICE_ITEMS?'Numbered invoices support eight item records: eight services without charges, or seven services plus charges. Remove an item or the additional charge before saving.':''
}
