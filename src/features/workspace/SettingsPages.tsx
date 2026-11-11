import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Building2, LockKeyhole, Save } from 'lucide-react'
import { PageHeader } from '../../components/PageHeader'
import { ThemeToggle } from '../../components/ThemeToggle'
import { auth, db } from '../../services/firebase'
import { useAuth } from '../auth/auth-context'
import { friendlyAuthError } from '../auth/auth-api'
import { useWorkspaceData } from './data-context'
import { FormFields } from './FormFields'
import { inputValues, settingsFields } from './schema'
import type { InputValues, SettingsKind } from './schema'
import { saveAccount, saveSettings } from './record-service'
import { AgencySettings } from './invoices/AgencySettings'

export function BusinessPage() {
  const { session } = useAuth()
  return <main id="workspace-content" tabIndex={-1}><PageHeader title="Business Profile" description="Your business identity and payment details belong only to your workspace."/><div className="profile-identity panel"><span className="business-mark"><Building2 size={28}/></span><div><h2>{session.status === 'ready' ? session.workspace.name : ''}</h2><p className="subtitle">Owner: {session.status === 'ready' ? session.profile.fullName : ''} · <a href="#settings">Edit account details</a></p><p className="field-help">Logo and QR image uploads are pending approved Storage integration.</p></div><button className="small-button" disabled>Upload logo · pending</button></div><SettingsForm kind="business" title="Business identity"/><div className="info-banner"><LockKeyhole size={18}/>Bank and UPI details are private. They are not published or added to draft PDFs automatically.</div><SettingsForm kind="payment" title="Bank and UPI details"/></main>
}
export function SettingsPage() {
  const { session } = useAuth()
  return <main id="workspace-content" tabIndex={-1}><PageHeader title="Settings" description="Manage your account, appearance and document preferences."/><AgencySettings/><AccountForm/><section className="panel settings-panel"><div className="detail-heading"><div><h2>Appearance</h2><p className="subtitle">Choose light or dark mode. Your selection is remembered on this browser.</p></div><ThemeToggle/></div></section><section className="panel settings-panel"><h2>Business preferences</h2><p className="subtitle">Workspace currency: <strong>{session.status === 'ready' ? session.workspace.currency : ''}</strong></p><p className="field-help">Currency changes are not available yet, to protect financial history. Update your timezone in Account information. Your business identity is under <a href="#business">Business Profile</a>.</p></section><SettingsForm kind="invoice" title="Invoice and quotation preferences"/></main>
}
function SettingsForm({ kind, title }: { kind: SettingsKind; title: string }) {
  const { settings } = useWorkspaceData(), { session, refreshSession } = useAuth()
  const row = settings[kind], fields = settingsFields[kind]
  function currentValues() {
    const values = inputValues(fields, row)
    if (!row && kind === 'business' && session.status === 'ready') values.name = session.workspace.name
    if (!row && kind === 'invoice') Object.assign(values, { invoicePrefix: 'INV', quotationPrefix: 'QUO', paymentTermsDays: '14' })
    return values
  }
  const [values, setValues] = useState<InputValues>(currentValues), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const baseline = useRef(row?.revision)
  useEffect(() => {
    if (!dirty) { setValues(currentValues()); baseline.current = row?.revision }
    // Current defaults only matter when records change, not while editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.revision, dirty])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return
    setBusy(true); setError(''); setMessage('')
    try { await saveSettings(auth, db, kind, values, baseline.current); setDirty(false); setMessage('Preferences saved to your private workspace.'); if (kind === 'business') refreshSession() }
    catch (issue) { setError(friendlyAuthError(issue)) } finally { setBusy(false) }
  }
  return <section className="panel settings-panel"><h2>{title}</h2><form onSubmit={submit}><fieldset className="plain-fieldset" disabled={busy}><FormFields fields={fields} values={values} setValues={next => { setValues(next); setDirty(true); setMessage('') }}/>{dirty && row?.revision !== baseline.current && <p className="auth-error" role="alert">These settings changed in another window. Reload the latest version before saving.</p>}{error && <p className="auth-error" role="alert">{error}</p>}{message && <p className="auth-success" role="status">{message}</p>}<div className="form-actions"><button type="button" className="small-button" onClick={() => { setDirty(false); setValues(currentValues()); baseline.current = row?.revision; setError('') }}>Reload saved values</button><button className="primary-button page-action" disabled={busy || (!dirty && Boolean(row))}><Save size={16}/>{busy ? 'Saving…' : 'Save preferences'}</button></div></fieldset></form></section>
}
function AccountForm() {
  const { session, refreshSession } = useAuth()
  const [values, setValues] = useState({ fullName: session.status === 'ready' ? session.profile.fullName : '', phone: session.status === 'ready' ? session.profile.phone ?? '' : '', whatsapp: session.status === 'ready' ? session.profile.whatsapp ?? '' : '', timezone: session.status === 'ready' ? session.workspace.timezone : 'Asia/Kolkata' })
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(''); try { await saveAccount(auth, db, values); refreshSession() } catch (issue) { setError(friendlyAuthError(issue)) } finally { setBusy(false) } }
  return <section className="panel settings-panel"><h2>Account information</h2><p className="subtitle">Verified email: {session.status === 'ready' ? session.identity.email : ''}</p><p className="field-help">Email and password changes require a separate verified account workflow. Your login email is read-only here.</p><form onSubmit={submit}><fieldset className="plain-fieldset" disabled={busy}><div className="form-grid">{(['fullName', 'phone', 'whatsapp', 'timezone'] as const).map(key => <label className="field" key={key}>{({ fullName: 'Owner name', phone: 'Phone', whatsapp: 'WhatsApp', timezone: 'Timezone (for example Asia/Kolkata)' })[key]}<input className="field-input" maxLength={key === 'fullName' ? 160 : key === 'timezone' ? 100 : 40} value={values[key]} required={key === 'fullName' || key === 'timezone'} onChange={event => setValues({ ...values, [key]: event.target.value })}/></label>)}</div>{error && <p className="auth-error" role="alert">{error}</p>}<div className="form-actions"><button className="primary-button page-action" disabled={busy}>{busy ? 'Saving…' : 'Save account information'}</button></div></fieldset></form></section>
}
