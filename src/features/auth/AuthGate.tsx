import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ArrowRight, ChartNoAxesCombined, LoaderCircle, Mail, ShieldAlert, ShieldCheck } from 'lucide-react'
import { ThemeToggle } from '../../components/ThemeToggle'
import { auth, db, isEmulatorMode } from '../../services/firebase'
import { useAuth } from './auth-context'
import { friendlyAuthError, loginWithEmail, refreshVerification, registerWithEmail, resendVerification, resetPassword } from './auth-api'
import { completeOnboarding } from './workspace-service'

function AuthFrame({ children }: { children: ReactNode }) {
  return <div className="auth-page"><header className="auth-header"><a href="#dashboard" className="auth-brand"><ChartNoAxesCombined aria-hidden="true" size={25}/>GrowthMark</a><ThemeToggle/></header><main className="auth-main"><div className="auth-intro"><p className="eyebrow">YOUR BUSINESS, IN FOCUS</p><h1>More clarity.<br/> More room to grow.</h1><p>A private workspace for your freelance business. Keep your work organized, on your terms.</p><span><ShieldCheck size={18}/> Your workspace belongs to you.</span></div><section className="auth-card surface" aria-label="Account access">{children}</section></main><p className="local-mode-note">{isEmulatorMode ? 'Emulator mode · Accounts and data stay in local Firebase emulators. Emails appear in the emulator terminal.' : `Real Firebase mode · ${auth.app.options.projectId} · Changes are saved to your real account.`}</p></div>
}
function Notice({ error, message }: { error?: string; message?: string }) {
  return <>{error && <p className="auth-error" role="alert">{error}</p>}{message && <p className="auth-success" role="status">{message}</p>}</>
}
function Submit({ busy, children }: { busy: boolean; children: ReactNode }) {
  return <button className="primary-button auth-submit" type="submit" disabled={busy}>{busy ? <><LoaderCircle className="loading-icon" size={17}/>Please wait…</> : <>{children}<ArrowRight size={17}/></>}</button>
}
function SignedOut() {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login')
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [fullName, setFullName] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  function changeMode(next: typeof mode) { setMode(next); setPassword(''); setError(''); setMessage('') }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      if (mode === 'register') await registerWithEmail(auth, { fullName, email, password })
      else if (mode === 'reset') { await resetPassword(auth, email); setMessage('If this email has an account, a password reset link has been requested. In emulator mode, open the link in the emulator terminal; in real mode, check your inbox.') }
      else await loginWithEmail(auth, email, password)
    } catch (reason) { setError(friendlyAuthError(reason)) }
    finally { setPassword(''); setBusy(false) }
  }
  return <AuthFrame><span className="auth-step">YOUR PRIVATE WORKSPACE</span><h2>{mode === 'register' ? 'Start with GrowthMark' : mode === 'reset' ? 'Reset your password' : 'Welcome back'}</h2><p className="auth-description">{mode === 'register' ? 'Create your freelancer account. Your clients won’t need accounts.' : mode === 'reset' ? 'Enter your account email to request a reset link.' : 'Sign in to pick up where you left off.'}</p><Notice error={error} message={message}/><form onSubmit={submit} aria-busy={busy}><fieldset disabled={busy} className="auth-fields">
    {mode === 'register' && <label className="field">Full name<input className="field-input" autoComplete="name" value={fullName} onChange={event => setFullName(event.target.value)} maxLength={160} required/></label>}
    <label className="field">Email address<input className="field-input" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} required/></label>
    {mode !== 'reset' && <label className="field">Password<input className="field-input" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} minLength={mode === 'register' ? 8 : undefined} required/>{mode === 'register' && <span className="field-help">Use at least 8 characters.</span>}</label>}
    <Submit busy={busy}>{mode === 'register' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}</Submit></fieldset></form>
    <div className="auth-links">{mode === 'login' ? <><button disabled={busy} onClick={() => changeMode('reset')}>Forgot password?</button><span>New to GrowthMark? <button disabled={busy} onClick={() => changeMode('register')}>Create an account</button></span></> : <button disabled={busy} onClick={() => changeMode('login')}>Back to sign in</button>}</div></AuthFrame>
}
function Verification() {
  const { session, refreshSession, signOut } = useAuth()
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('')
  async function perform(check: boolean) {
    setBusy(true); setMessage(''); setError('')
    try {
      if (check) {
        const verified = await refreshVerification(auth)
        if (verified) refreshSession()
        else setMessage('Your email is not verified yet. Open the verification link, then check again.')
      } else { await resendVerification(auth); setMessage('Verification link requested. Check the emulator terminal in emulator mode, or your inbox in real mode.') }
    } catch (reason) { setError(friendlyAuthError(reason)) } finally { setBusy(false) }
  }
  return <AuthFrame><span className="auth-emblem"><Mail size={25}/></span><h2>Check your email</h2><p className="auth-description">Verify <strong>{session.status === 'verification-required' ? session.identity.email : ''}</strong> before opening your workspace. {isEmulatorMode ? 'Verification links appear in the emulator terminal.' : 'Open the verification email in your inbox, then return here.'}</p><Notice error={error} message={message}/><button className="primary-button auth-submit" disabled={busy} onClick={() => { void perform(true) }}>{busy ? 'Checking…' : 'I’ve verified my email'}</button><button className="secondary-button" disabled={busy} onClick={() => { void perform(false) }}>Send another verification link</button><button className="text-button" disabled={busy} onClick={() => { void signOut().catch(() => {}) }}>Sign out</button></AuthFrame>
}
function Onboarding() {
  const { session, refreshSession, signOut } = useAuth()
  const [ownerName, setOwnerName] = useState(session.status === 'onboarding' ? session.identity.displayName ?? '' : '')
  const [businessName, setBusinessName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return
    setBusy(true); setError('')
    try { await completeOnboarding(auth, db, { ownerName, businessName }); refreshSession() }
    catch (reason) { setError(friendlyAuthError(reason)) } finally { setBusy(false) }
  }
  return <AuthFrame><span className="auth-step">ONE LAST STEP</span><h2>Make this space yours</h2><p className="auth-description">Tell us a little about your business. Your private workspace is created automatically.</p><Notice error={error}/><form onSubmit={submit} aria-busy={busy}><fieldset disabled={busy} className="auth-fields"><label className="field">Owner name<input className="field-input" autoComplete="name" maxLength={160} value={ownerName} onChange={event => setOwnerName(event.target.value)} required/></label><label className="field">Business or agency name<input className="field-input" autoComplete="organization" maxLength={160} value={businessName} onChange={event => setBusinessName(event.target.value)} required/></label><p className="field-help">Start with INR and Asia/Kolkata time. Business logo uploads will be available in a later phase.</p><Submit busy={busy}>Open my workspace</Submit></fieldset></form><button className="text-button" disabled={busy} onClick={() => { void signOut().catch(() => {}) }}>Sign out</button></AuthFrame>
}
export function AuthGate({ children }: { children: ReactNode }) {
  const { session, refreshSession, signOut } = useAuth()
  if (session.status === 'ready') return children
  if (session.status === 'signed-out') return <SignedOut/>
  if (session.status === 'verification-required') return <Verification/>
  if (session.status === 'onboarding') return <Onboarding/>
  return <AuthFrame>{session.status === 'loading' ? <><LoaderCircle className="loading-icon auth-emblem" size={28}/><h2>Opening your workspace</h2><p className="auth-description" role="status">Checking your session and workspace access… {isEmulatorMode ? 'Make sure the local Firebase emulators are running.' : 'Connecting to your real Firebase project.'}</p></> : session.status === 'live-disabled' ? <><ShieldCheck className="auth-emblem" size={28}/><h2>Live sign-in is not enabled</h2><p className="auth-description">This phase is available in local development with the Firebase emulators. No production authentication changes have been made.</p></> : <><ShieldAlert className="auth-emblem" size={28}/><h2>{session.status === 'suspended' ? 'Workspace access is unavailable' : 'We couldn’t open your workspace'}</h2><Notice error={session.status === 'error' ? session.message : 'This account does not currently have workspace access. Contact support if you need help.'}/><button className="secondary-button" onClick={refreshSession}>Try again</button><button className="text-button" onClick={() => { void signOut().catch(() => {}) }}>Sign out</button></>}</AuthFrame>
}
