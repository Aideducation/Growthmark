import { useState } from 'react'
import type { FormEvent } from 'react'
import { Download, Pencil, Plus, Trash2 } from 'lucide-react'
import { auth, db } from '../../services/firebase'
import { Modal } from '../../components/Modal'
import { PageHeader } from '../../components/PageHeader'
import { useAuth } from '../auth/auth-context'
import { friendlyAuthError } from '../auth/auth-api'
import { useWorkspaceData } from './data-context'
import { calculateDocument, calculateLine, money } from './money'
import { dateValue, num, str } from './schema'
import type { RecordRow } from './schema'
import { saveDraftItem } from './record-service'

export function DraftDetails({ kind, record, onEdit }: { kind: 'quotations' | 'invoices'; record: RecordRow; onEdit: () => void }) {
  const { records, settings, items } = useWorkspaceData(), { session } = useAuth()
  const currency = session.status === 'ready' ? session.workspace.currency : 'INR'
  const lines = items[`${kind}/${record.id}`] ?? [], totals = calculateDocument(lines)
  const [editor, setEditor] = useState<{ line: RecordRow | null } | null>(null), [removing, setRemoving] = useState<RecordRow | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const editable = record.state === 'draft'
  async function pdf() {
    setBusy(true); setError('')
    try {
      if (lines.length > 100) throw new Error('This draft exceeds the supported 100 line items. Remove excess lines before exporting a complete PDF.')
      const { downloadDraftPdf } = await import('./pdf')
      await downloadDraftPdf({ kind, record, lines, client: records.clients.find(row => row.id === record.clientId), business: settings.business, businessName: session.status === 'ready' ? session.workspace.name : 'Business', currency, footer: [str(settings.invoice, 'footer'), str(settings.invoice, 'thankYouMessage')].filter(Boolean).join('\n') })
      setMessage('Draft PDF generated. Check your browser’s downloads. Nothing was issued or published.')
    } catch (issue) { setError(friendlyAuthError(issue)) } finally { setBusy(false) }
  }
  async function remove() {
    if (!removing) return
    setBusy(true); setError('')
    try { await saveDraftItem(auth, db, kind, record.id, { description: '', quantity: '1', price: '0', tax: '0', discount: '0' }, removing.id, removing.revision, true); setRemoving(null); setMessage('Draft line removed.') }
    catch (issue) { setError(friendlyAuthError(issue)) } finally { setBusy(false) }
  }
  if (!( `${kind}/${record.id}` in items)) return <p className="info-banner" role="status">Loading saved draft services…</p>
  return <><PageHeader title={str(record, 'title')} description={`${kind === 'invoices' ? 'Invoice' : 'Quotation'} draft · ${str(records.clients.find(row => row.id === record.clientId), 'name') || 'Linked client'}`} action={<div className="row-actions">{editable && <button className="small-button" onClick={onEdit}><Pencil size={16}/>Edit details</button>}<button className="primary-button page-action" onClick={() => { void pdf() }} disabled={busy || !lines.length}><Download size={16}/>{busy ? 'Preparing…' : 'Download draft PDF'}</button></div>}/>
    <div className="info-banner">{editable ? 'Editable draft' : 'Archived · read-only'} · No official number, issued balance or public payment link. Totals are estimates, not verified receivables.</div>
    {error && <p className="auth-error" role="alert">{error}</p>}{message && <p className="auth-success" role="status">{message}</p>}
    <section className="panel module-panel"><div className="detail-heading"><div><h2>Services and line items</h2><p className="field-help">Date {dateValue(record.issueAt)} · Due / expiry {dateValue(record.dueAt) || 'Not set'}</p></div><button className="small-button" disabled={!editable || lines.length >= 100} onClick={() => setEditor({ line: null })}><Plus size={16}/>Add service</button></div>{!lines.length ? <div className="empty-state"><h2>Add your first service</h2><p>Enter a quantity and price to calculate your draft estimate.</p></div> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Service</th><th>Quantity</th><th>Unit price</th><th>Discount / tax</th><th>Total</th><th>Actions</th></tr></thead><tbody>{lines.map(line => <tr key={line.id}><td>{str(line, 'description')}</td><td>{num(line, 'quantityMilli') / 1000}</td><td>{money(num(line, 'unitPriceMinor'), currency)}</td><td>{num(line, 'discountBps') / 100}% / {num(line, 'taxRateBps') / 100}%</td><td>{money(calculateLine(line).total, currency)}</td><td>{editable && <div className="row-actions"><button className="small-button" onClick={() => setEditor({ line })} aria-label={`Edit service ${str(line, 'description')}`}><Pencil size={15}/></button><button className="small-button" onClick={() => setRemoving(line)} aria-label={`Remove service ${str(line, 'description')}`}><Trash2 size={15}/></button></div>}</td></tr>)}</tbody></table></div>}
    <dl className="draft-totals"><div><dt>Subtotal</dt><dd>{money(totals.subtotal, currency)}</dd></div><div><dt>Discount</dt><dd>−{money(totals.discount, currency)}</dd></div><div><dt>Tax</dt><dd>{money(totals.tax, currency)}</dd></div><div className="total"><dt>Draft estimate</dt><dd>{money(totals.total, currency)}</dd></div></dl>
    <div className="document-notes"><h3>Terms</h3><p>{str(record, 'terms') || 'No terms added.'}</p><h3>Notes included in the PDF</h3><p>{str(record, 'notes') || 'No notes added.'}</p><p className="field-help">Discount is applied per line before tax. Each step rounds half up to the currency’s minor unit. PDF export does not include your private bank settings.</p></div></section>
    {editor && <LineEditor kind={kind} draftId={record.id} line={editor.line} defaults={settings.invoice} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setMessage('Service saved.') }}/>} 
    {removing && <Modal title="Remove this draft service?" busy={busy} onClose={() => setRemoving(null)}><p className="subtitle">This removes only an editable draft line. Issued financial records are not affected.</p>{error && <p className="auth-error" role="alert">{error}</p>}<div className="form-actions"><button className="secondary-button" disabled={busy} onClick={() => setRemoving(null)}>Keep service</button><button className="primary-button page-action" disabled={busy} onClick={() => { void remove() }}>Remove service</button></div></Modal>}
  </>
}
function LineEditor({ kind, draftId, line, defaults, onClose, onSaved }: { kind: 'quotations' | 'invoices'; draftId: string; line: RecordRow | null; defaults: RecordRow | null; onClose: () => void; onSaved: () => void }) {
  const [values, setValues] = useState({ description: str(line, 'description'), quantity: line ? String(num(line, 'quantityMilli') / 1000) : '1', price: line ? (num(line, 'unitPriceMinor') / 100).toFixed(2) : '0.00', tax: String(num(line ?? defaults, line ? 'taxRateBps' : 'defaultTaxBps') / 100), discount: String(num(line ?? defaults, line ? 'discountBps' : 'defaultDiscountBps') / 100) })
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(''); try { await saveDraftItem(auth, db, kind, draftId, values, line?.id, line?.revision); onSaved() } catch (issue) { setError(friendlyAuthError(issue)) } finally { setBusy(false) } }
  return <Modal title={line ? 'Edit service' : 'Add service'} onClose={onClose} busy={busy}><form onSubmit={submit}><fieldset className="plain-fieldset" disabled={busy}><div className="form-grid"><label className="field span-two">Description<textarea className="field-input" value={values.description} maxLength={2000} required onChange={event => setValues({ ...values, description: event.target.value })}/></label>{([{ key: 'quantity', title: 'Quantity', step: '0.001', min: 0.001 }, { key: 'price', title: 'Unit price', step: '0.01', min: 0 }, { key: 'tax', title: 'Tax (%)', step: '0.01', min: 0, max: 100 }, { key: 'discount', title: 'Discount (%)', step: '0.01', min: 0, max: 100 }] as const).map(field => <label className="field" key={field.key}>{field.title}<input className="field-input" type="number" step={field.step} min={field.min} max={'max' in field ? field.max : undefined} value={values[field.key]} required onChange={event => setValues({ ...values, [field.key]: event.target.value })}/></label>)}</div>{error && <p className="auth-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button page-action" disabled={busy}>{busy ? 'Saving…' : 'Save service'}</button></div></fieldset></form></Modal>
}
