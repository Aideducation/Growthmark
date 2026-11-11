import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Archive, ArrowLeft, Download, Eye, Pencil, Plus } from 'lucide-react'
import { collection, doc } from 'firebase/firestore'
import { auth, db } from '../../services/firebase'
import { PageHeader } from '../../components/PageHeader'
import { Modal } from '../../components/Modal'
import { useAuth } from '../auth/auth-context'
import { friendlyAuthError } from '../auth/auth-api'
import { useWorkspaceData } from './data-context'
import { dateValue, entityFields, inputValues, label, num, str } from './schema'
import type { Entity, RecordRow } from './schema'
import { archiveRecord, saveRecord } from './record-service'
import { calculateDocument, money } from './money'
import { FormFields } from './FormFields'
import { DraftDetails } from './DraftDetails'
import { exportCsv } from './export'

const titles: Record<Entity, string> = { clients: 'Clients', projects: 'Projects', tasks: 'Tasks', quotations: 'Quotations', invoices: 'Invoices', payments: 'Payments' }
const single: Record<Entity, string> = { clients: 'client', projects: 'project', tasks: 'task', quotations: 'quotation draft', invoices: 'invoice draft', payments: 'manual payment' }
const descriptions: Record<Entity, string> = {
  clients: 'The people and businesses you work with, all in one private place.',
  projects: 'Turn your client work into clear budgets, deadlines and progress.',
  tasks: 'Know what needs your attention and what comes next.',
  quotations: 'Prepare service estimates and download clearly marked draft PDFs.',
  invoices: 'Prepare draft invoices. Issuance, official numbers and public links remain disabled.',
  payments: 'A private register of owner-recorded collections. Entries are not independently verified.',
}
export function RecordPage({ kind }: { kind: Entity }) {
  const { records, items } = useWorkspaceData(), { session } = useAuth()
  const currency = session.status === 'ready' ? session.workspace.currency : 'INR'
  const [search, setSearch] = useState(''), [status, setStatus] = useState('all'), [editor, setEditor] = useState<{ row: RecordRow | null } | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null), [archive, setArchive] = useState<RecordRow | null>(null)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('')
  const rows = records[kind], detail = rows.find(row => row.id === detailId)
  const match = (row: RecordRow) => Object.values(row).filter(value => typeof value === 'string').join(' ').toLowerCase().includes(search.toLowerCase())
  const filtered = rows.filter(row => match(row) && (status === 'all' || str(row, 'status') === status || str(row, 'state') === status || str(row, 'method') === status))
  const states = [...new Set(rows.map(row => str(row, 'status') || str(row, 'state') || str(row, 'method')).filter(Boolean))]
  const clientName = (row: RecordRow) => str(records.clients.find(client => client.id === row.clientId), 'name') || 'Linked client'
  const projectName = (row: RecordRow) => str(records.projects.find(project => project.id === row.projectId), 'name') || 'No project'
  const rowTitle = (row: RecordRow) => str(row, 'name') || str(row, 'title') || clientName(row)
  const draft = kind === 'quotations' || kind === 'invoices'
  const requiresClient = kind !== 'clients' && kind !== 'tasks'
  async function confirmArchive() {
    if (!archive || kind === 'payments' || kind === 'tasks') return
    setBusy(true); setError('')
    try { await archiveRecord(auth, db, kind, archive.id, archive.revision); setArchive(null); setMessage('Record archived. Its history has been preserved.') }
    catch (issue) { setError(friendlyAuthError(issue)) } finally { setBusy(false) }
  }
  if (detail && draft) return <main tabIndex={-1} id="workspace-content"><button className="back-button" onClick={() => setDetailId(null)}><ArrowLeft size={16}/>All {titles[kind].toLowerCase()}</button><DraftDetails kind={kind} record={detail} onEdit={() => setEditor({ row: detail })}/>{editor && <RecordEditor kind={kind} row={editor.row} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setMessage('Draft details saved.') }}/>}</main>
  return <main tabIndex={-1} id="workspace-content"><PageHeader title={titles[kind]} description={descriptions[kind]} action={<button className="primary-button page-action" onClick={() => { setError(''); setEditor({ row: null }) }} disabled={requiresClient && !records.clients.length}><Plus size={17}/>Add {single[kind]}</button>}/>
    {message && <p className="auth-success" role="status">{message}</p>}{error && <p className="auth-error" role="alert">{error}</p>}
    {requiresClient && !records.clients.length && <div className="info-banner">Start by <a href="#clients">adding a client</a> before creating {titles[kind].toLowerCase()}.</div>}
    {kind === 'payments' && <div className="info-banner">Record any full or partial amount received. Payment history is append-only. Issued-invoice balances, settlement, reversals and verification require the secure backend and are not available here.</div>}
    {draft && <div className="info-banner">Draft totals are estimates. PDF files are marked DRAFT. <button disabled title="Requires the secure backend">Issue document</button><button disabled title="Requires the secure backend">Public payment link</button></div>}
    <section className="panel module-panel"><div className="list-toolbar"><input className="field-input search-input" aria-label={`Search ${titles[kind].toLowerCase()}`} placeholder={`Search ${titles[kind].toLowerCase()}…`} value={search} onChange={event => setSearch(event.target.value)}/><select className="field-input filter-input" aria-label="Filter status" value={status} onChange={event => setStatus(event.target.value)}><option value="all">All {kind === 'payments' ? 'methods' : 'statuses'}</option>{states.map(state => <option key={state} value={state}>{label(state)}</option>)}</select><button className="small-button" disabled={!filtered.length} onClick={() => exportCsv(titles[kind], filtered.map(row => ({ name: rowTitle(row), client: kind === 'clients' ? str(row, 'company') : clientName(row), status: str(row, 'status') || str(row, 'state') || 'owner-recorded', ...(kind === 'payments' ? { amount: (num(row, 'amountMinor') / 100).toFixed(2), currency, method: str(row, 'method'), paidAt: dateValue(row.paidAt) } : {}) })))}><Download size={15}/>CSV</button></div>
      {!filtered.length ? <div className="empty-state"><h2>{rows.length ? 'No matching records' : `No ${titles[kind].toLowerCase()} yet`}</h2><p>{rows.length ? 'Try a different search or filter.' : 'Your first real record will appear here. No sample data has been added.'}</p></div> : <div className="table-scroll"><table className="data-table"><caption className="sr-only">{titles[kind]} in your workspace</caption><thead><tr><th>{kind === 'payments' ? 'Client' : 'Name'}</th><th>{kind === 'clients' ? 'Contact' : 'Context'}</th><th>{kind === 'payments' ? 'Received' : draft ? 'Estimate' : 'Status'}</th><th>{kind === 'payments' ? 'Date / method' : 'Details'}</th><th>Actions</th></tr></thead><tbody>{filtered.map(row => <tr key={row.id}><td><strong>{rowTitle(row)}</strong>{kind === 'clients' && <small>{str(row, 'company')}</small>}</td><td>{kind === 'clients' ? <>{str(row, 'email') || 'No email'}<small>{str(row, 'phone')}</small></> : <>{clientName(row)}<small>{projectName(row)}</small></>}</td><td>{kind === 'payments' ? money(num(row, 'amountMinor'), currency) : draft ? money(calculateDocument(items[`${kind}/${row.id}`] ?? []).total, currency) : <span className="record-badge">{label(str(row, 'status'))}</span>}</td><td>{kind === 'projects' ? <>{money(num(row, 'budgetMinor'), currency)}<small>{num(row, 'progressPercent')}% complete · {dateValue(row.deadlineAt) || 'No deadline'}</small></> : kind === 'tasks' ? <>{label(str(row, 'priority'))}<small>{dateValue(row.dueAt) || 'No due date'}</small></> : kind === 'payments' ? <>{dateValue(row.paidAt)}<small>{label(str(row, 'method'))} · Owner recorded</small></> : draft ? <>{label(str(row, 'state'))}<small>{dateValue(row.dueAt) || 'No due date'}</small></> : str(row, 'services') || 'No services listed'}</td><td><div className="row-actions"><button className="small-button" onClick={() => setDetailId(row.id)} aria-label={`View ${rowTitle(row)}`}><Eye size={15}/>View</button>{kind !== 'payments' && str(row, 'state') !== 'archived' && <button className="small-button" onClick={() => setEditor({ row })} aria-label={`Edit ${rowTitle(row)}`}><Pencil size={15}/>Edit</button>}{kind !== 'payments' && kind !== 'tasks' && str(row, 'status') !== 'archived' && str(row, 'state') !== 'archived' && <button className="small-button" onClick={() => { setError(''); setArchive(row) }} aria-label={`Archive ${rowTitle(row)}`}><Archive size={15}/></button>}</div></td></tr>)}</tbody></table></div>}
      <p className="list-count">{filtered.length} of {rows.length} loaded records</p>
    </section>
    {editor && <RecordEditor kind={kind} row={editor.row} onClose={() => setEditor(null)} onSaved={id => { setEditor(null); setMessage('Record saved to your private workspace.'); if (draft) setDetailId(id) }}/>} 
    {detail && !draft && <Modal title={rowTitle(detail)} onClose={() => setDetailId(null)}><dl className="record-details">{entityFields[kind].map(field => <div key={field.key}><dt>{field.label}</dt><dd>{field.type === 'money' ? money(num(detail, field.key), currency) : field.type === 'date' || field.type === 'datetime-local' ? dateValue(detail[field.key]) || 'Not set' : field.type === 'client' ? clientName(detail) : field.type === 'project' ? projectName(detail) : String(detail[field.key] ?? '') || 'Not set'}</dd></div>)}</dl>{kind === 'clients' && <div className="related-summary"><h3>Related business records</h3><p>{records.projects.filter(row => row.clientId === detail.id).length} projects · {records.invoices.filter(row => row.clientId === detail.id).length} invoice drafts</p><p>Owner-recorded collections: <strong>{money(records.payments.filter(row => row.clientId === detail.id).reduce((total, row) => total + num(row, 'amountMinor'), 0), currency)}</strong></p><p className="field-help">Authoritative total billed and outstanding invoice balance are pending secure issuance. Use Projects, Invoices and Payments to inspect the related records.</p></div>}</Modal>}
    {archive && <Modal title={`Archive ${rowTitle(archive)}?`} onClose={() => setArchive(null)} busy={busy}><p className="subtitle">History is preserved. Archived quotations and invoice drafts become read-only.</p>{error && <p role="alert" className="auth-error">{error}</p>}<div className="form-actions"><button className="secondary-button" disabled={busy} onClick={() => setArchive(null)}>Keep record</button><button className="primary-button page-action" disabled={busy} onClick={() => { void confirmArchive() }}>Archive record</button></div></Modal>}
  </main>
}
function RecordEditor({ kind, row, onClose, onSaved }: { kind: Entity; row: RecordRow | null; onClose: () => void; onSaved: (id: string) => void }) {
  const { session } = useAuth(), [values, setValues] = useState(() => inputValues(entityFields[kind], row)), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const original = useRef(row)
  const paymentId = useRef(kind === 'payments' && session.status === 'ready' ? doc(collection(db, 'workspaces', session.identity.userId, 'payments')).id : undefined)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return
    setBusy(true); setError('')
    try { const id = await saveRecord(auth, db, kind, values, original.current?.id ?? paymentId.current, original.current?.revision); onSaved(id) }
    catch (issue) { setError(friendlyAuthError(issue)) } finally { setBusy(false) }
  }
  return <Modal title={`${row ? 'Edit' : 'Add'} ${single[kind]}`} onClose={onClose} busy={busy}><form onSubmit={submit}><fieldset className="plain-fieldset" disabled={busy}><FormFields fields={entityFields[kind]} values={values} setValues={setValues} editing={Boolean(row)}/>{kind === 'payments' && <p className="info-banner">This is your report of money received. It cannot be edited or deleted afterward and does not verify a bank transaction.</p>}{error && <p role="alert" className="auth-error">{error}</p>}<div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button page-action" disabled={busy}>{busy ? 'Saving…' : 'Save record'}</button></div></fieldset></form></Modal>
}
