import { smallPng } from './images'
import type { InvoicePaymentDetails } from './allocation-types'

export function InvoicePaymentEditor({ value, change, reset, error }: { value: InvoicePaymentDetails; change: (value: InvoicePaymentDetails) => void; reset: () => void; error: (value: string) => void }) {
  const fields = { upiId: 'UPI ID', upiHolder: 'UPI holder', bankHolder: 'Account holder', bankName: 'Bank name', accountNumber: 'Account number', ifsc: 'IFSC', branch: 'Branch', otherMethod: 'Other method', instructions: 'Payment instructions' } as const
  return <details><summary>Invoice-specific payment details</summary><p className="field-help">These instructions affect only this invoice. Your original agency snapshot and Agency Settings stay unchanged.</p><div className="form-grid">
    {(['upiEnabled', 'bankEnabled', 'cashEnabled', 'otherEnabled'] as const).map(key => <label className="field" key={key}><span><input type="checkbox" checked={value[key]} onChange={event => change({ ...value, [key]: event.target.checked })}/> {({ upiEnabled: 'Enable UPI', bankEnabled: 'Enable bank transfer', cashEnabled: 'Enable cash', otherEnabled: 'Enable other' })[key]}</span></label>)}
    {Object.entries(fields).map(([key, label]) => <label className="field" key={key}>{label}{key === 'instructions' ? <textarea className="field-input" maxLength={3000} value={value.instructions} onChange={event => change({ ...value, instructions: event.target.value })}/> : <input className="field-input" maxLength={160} value={String(value[key as keyof InvoicePaymentDetails])} onChange={event => change({ ...value, [key]: event.target.value })}/>}</label>)}
    <label className="field">Invoice UPI QR<input type="file" accept="image/png,image/jpeg" onChange={event => { const file = event.target.files?.[0]; if (file) void smallPng(file).then(qr => change({ ...value, qr })).catch(issue => error(String(issue.message))) }}/></label>
    {value.qr && <button type="button" className="small-button" onClick={() => change({ ...value, qr: '' })}>Remove invoice QR</button>}
  </div><button type="button" className="small-button" onClick={reset}>Reset to original snapshot</button></details>
}
