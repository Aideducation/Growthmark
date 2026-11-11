import { useEffect, useState } from 'react'
import { auth, db } from '../../../services/firebase'
import { useAuth } from '../../auth/auth-context'
import { useWorkspaceData } from '../data-context'
import { str } from '../schema'
import { agencySections, defaultAgency } from './model'
import type { Agency } from './model'
import { loadAgency, saveAgency } from './service'
import { smallPng } from './images'
import './invoices.css'

export function initialAgency(settings: ReturnType<typeof useWorkspaceData>['settings'], name: string, owner: string): Agency {
  const base = defaultAgency(), business = settings.business, payment = settings.payment
  Object.assign(base, { name, ownerName: owner })
  for (const key of ['name', 'businessType', 'email', 'phone', 'whatsapp', 'website', 'city', 'state', 'country', 'postalCode', 'gstin']) if (str(business, key)) base[key] = str(business, key)
  base.address = str(business, 'street')
  Object.assign(base, { upiId: str(payment, 'upiId'), upiHolder: str(payment, 'accountHolder'), bankHolder: str(payment, 'accountHolder'), bankName: str(payment, 'bankName'), accountNumber: str(payment, 'accountNumber'), ifsc: str(payment, 'ifsc'), instructions: str(payment, 'instructions') })
  return base
}
export function AgencySettings() {
  const { session } = useAuth(), { settings } = useWorkspaceData()
  const [value, setValue] = useState(() => initialAgency(settings, session.status === 'ready' ? session.workspace.name : '', session.status === 'ready' ? session.profile.fullName : ''))
  const [baseline, setBaseline] = useState<number>(), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('')
  useEffect(() => { let active = true; void loadAgency(auth, db).then(result => { if (active && result) { setValue(result.agency); setBaseline(result.revision) } }).catch(() => { if (active) setError('Agency storage is not available under the selected rules. You can preview changes here; saving requires the reviewed agency/invoice rules proposal. Existing settings are unchanged.') }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [])
  async function save() {
    setBusy(true); setError(''); setMessage('')
    try { await saveAgency(auth, db, value, baseline); setBaseline((baseline ?? 0) + 1); setMessage('Agency profile saved privately. Existing invoice snapshots are unchanged.') }
    catch (issue) { setError(issue instanceof Error ? issue.message : 'Agency profile could not be saved.') } finally { setBusy(false) }
  }
  return <section className="agency-invoices panel settings-panel" aria-label="Agency Profile"><div className="detail-heading"><div><h2>Agency Profile</h2><p className="subtitle">Branding, GST and payment defaults for new invoice drafts.</p></div><span className="record-badge">Private workspace</span></div><p className="info-banner">New invoices always begin at 0% GST. Your preferred rate is available as an explicit action. Official numbering is reserved for secure issuance. Card gateways are not connected.</p>{error && <p role="alert" className="auth-error">{error}</p>}{message && <p role="status" className="auth-success">{message}</p>}<form onSubmit={event => { event.preventDefault(); void save() }}><fieldset className="plain-fieldset" disabled={busy || loading}>
    {Object.entries(agencySections).map(([section, fields]) => <section className="agency-form-section" key={section}><h3>{section}</h3><div className="form-grid">{Object.entries(fields).map(([key, label]) => <label className="field" key={key}>{label}{key.endsWith('Enabled') ? <select className="field-input" value={value[key]} onChange={event => setValue({ ...value, [key]: event.target.value })}><option value="false">Disabled</option><option value="true">Enabled</option></select> : ['priceMode', 'gstMode', 'currency'].includes(key) ? <select className="field-input" value={value[key]} onChange={event => setValue({ ...value, [key]: event.target.value })}>{(key === 'priceMode' ? ['exclusive', 'inclusive'] : key === 'gstMode' ? ['split', 'igst'] : ['INR', 'USD', 'EUR', 'GBP']).map(option => <option key={option} value={option}>{option === 'split' ? 'CGST + SGST' : option.toUpperCase()}</option>)}</select> : ['address', 'instructions', 'footer', 'notes', 'terms', 'paymentTerms'].includes(key) ? <textarea className="field-input" value={value[key]} maxLength={3000} onChange={event => setValue({ ...value, [key]: event.target.value })}/> : <input className="field-input" type={key === 'brandColor' ? 'color' : key === 'email' ? 'email' : 'text'} inputMode={['defaultGst', 'dueDays'].includes(key) ? 'decimal' : undefined} list={key === 'defaultGst' ? 'agency-gst-rates' : undefined} value={value[key]} required={key === 'name'} maxLength={['name', 'ownerName'].includes(key) ? 160 : 3000} onChange={event => setValue({ ...value, [key]: event.target.value })}/>}</label>)}</div></section>)}
    <datalist id="agency-gst-rates">{['0','5','12','18','28'].map(rate => <option key={rate} value={rate}/>)}</datalist>
    <section className="agency-form-section"><h3>Logo, QR and signature</h3><p className="field-help">PNG or JPEG up to 1 MB input, resized to 512 pixels and limited to about 32 KB per saved image. Images remain private in Firestore; no paid Storage service is used.</p><div className="agency-images">{(['logo', 'qr', 'signature'] as const).map(key => <div key={key}><label className="field">{key}<input type="file" accept="image/png,image/jpeg" onChange={event => { const file = event.target.files?.[0]; if (file) { setBusy(true); void smallPng(file).then(image => setValue(current => ({ ...current, [key]: image }))).catch(issue => setError(String(issue.message))).finally(() => setBusy(false)) } }}/></label>{value[key] && <><img src={value[key]} alt={`Agency ${key} preview`}/><button className="text-button" type="button" onClick={() => setValue({ ...value, [key]: '' })}>Remove {key}</button></>}</div>)}</div></section>
    <section className="agency-preview" style={{ borderTopColor: value.brandColor }}><h3>{value.name || 'Your agency'}</h3><p>{value.ownerName}</p><p>{[value.address, value.city, value.state, value.postalCode, value.country].filter(Boolean).join(', ')}</p><p>{[value.email, value.phone, value.website].filter(Boolean).join(' · ')}</p>{value.gstin && <p>GSTIN: {value.gstin}</p>}<p className="field-help">Profile preview · Preferred currency {value.currency}. Drafts currently use the workspace currency to keep existing reports consistent.</p></section><div className="form-actions"><button className="primary-button page-action" disabled={busy || loading}>{busy ? 'Saving…' : 'Save agency profile'}</button></div></fieldset></form></section>
}
