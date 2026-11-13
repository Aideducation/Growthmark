export function invoiceWorkflowEnabled(value:string|undefined,emulators:boolean,candidate:boolean):boolean {
  if(value===undefined||value===''||value==='false')return candidate
  if(value!=='true'||emulators&&!candidate)throw new Error('Numbered invoices require real Firebase or the isolated candidate preview.')
  return true
}
