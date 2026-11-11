import { useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { PageHeader } from '../../components/PageHeader'
import { useWorkspaceData } from './data-context'
import { useAuth } from '../auth/auth-context'
import { money, scaledInteger } from './money'
import { str } from './schema'

export function RetainersPage() {
  const { records } = useWorkspaceData(), { session } = useAuth()
  const [client, setClient] = useState(''), [service, setService] = useState(''), [amount, setAmount] = useState(''), [start, setStart] = useState('')
  const currency = session.status === 'ready' ? session.workspace.currency : 'INR'
  let total = 0, validAmount = false
  try { total = scaledInteger(amount); validAmount = total > 0 } catch { /* Unsaved input can be incomplete. */ }
  const valid = Boolean(client && service.trim() && validAmount && /^\d{4}-\d{2}-\d{2}$/.test(start) && !Number.isNaN(Date.parse(start)))
  const periods = valid ? Array.from({ length: 6 }, (_, index) => {
    const base = new Date(`${start}T00:00:00Z`), year = base.getUTCFullYear(), month = base.getUTCMonth() + index
    const day = Math.min(base.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate())
    return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10)
  }) : []
  return <main id="workspace-content" tabIndex={-1}><PageHeader title="Retainers" description="Plan recurring client agreements and preview monthly billing dates."/><div className="info-banner"><CalendarClock size={19}/><span><strong>Saving retainers is pending.</strong> The current security rules deny retainer records. This page provides an unsaved planning preview only. No recurring invoice or payment is created.</span></div><section className="panel settings-panel"><h2>Unsaved retainer planner</h2><div className="form-grid"><label className="field">Client<select className="field-input" value={client} onChange={event => setClient(event.target.value)}><option value="">Select a client</option>{records.clients.map(row => <option value={row.id} key={row.id}>{str(row, 'name')}</option>)}</select></label><label className="field">Service<input className="field-input" value={service} onChange={event => setService(event.target.value)} maxLength={200}/></label><label className="field">Monthly amount ({currency})<input className="field-input" type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)}/></label><label className="field">First billing date<input className="field-input" type="date" value={start} onInput={event => setStart(event.currentTarget.value)} onChange={event => setStart(event.target.value)}/></label></div><button className="secondary-button" disabled>Save agreement · pending secure persistence</button><p className="field-help">This unsaved plan is cleared when you leave the page.</p></section><section className="panel module-panel"><h2>Monthly schedule preview</h2>{!periods.length ? <div className="empty-state">Choose a client, service, positive amount and first billing date.</div> : <table className="data-table"><thead><tr><th>Proposed billing date</th><th>Planned amount</th><th>State</th></tr></thead><tbody>{periods.map(date => <tr key={date}><td>{date}</td><td>{money(total, currency)}</td><td>Unsaved plan</td></tr>)}</tbody></table>}</section></main>
}
