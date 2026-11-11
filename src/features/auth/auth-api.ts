import { createUserWithEmailAndPassword, GoogleAuthProvider, reload, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, signOut, updateProfile } from 'firebase/auth'
import type { Auth } from 'firebase/auth'
import type { RegistrationInput } from './contracts.ts'
import { isSelectedLiveAuth } from '../../services/firebase-mode.ts'

/** Retained name for compatibility: allow configured live Auth or a known local emulator. */
export function requireLocalAuth(auth: Auth) {
  if (isSelectedLiveAuth(auth)) return
  const port = auth.app.options.projectId === 'demo-growthmark-security' ? 9099
    : auth.app.options.projectId === 'demo-growthmark-security-tests' ? 9199 : null
  if (!port || auth.emulatorConfig?.host !== '127.0.0.1' || auth.emulatorConfig?.port !== port) {
    throw new Error('Live authentication is disabled. Start the local Firebase emulators.')
  }
}
export async function registerWithEmail(auth: Auth, input: RegistrationInput) {
  requireLocalAuth(auth)
  const fullName = input.fullName.trim()
  if (!fullName || fullName.length > 160) throw new Error('Enter an owner name between 1 and 160 characters.')
  if (input.password.length < 8) throw new Error('Use a password with at least 8 characters.')
  const result = await createUserWithEmailAndPassword(auth, input.email.trim(), input.password)
  await updateProfile(result.user, { displayName: fullName })
  await sendEmailVerification(result.user)
  return result.user
}
export async function loginWithEmail(auth: Auth, email: string, password: string) {
  requireLocalAuth(auth)
  return signInWithEmailAndPassword(auth, email.trim(), password)
}
export async function loginWithGoogle(auth: Auth) {
  requireLocalAuth(auth)
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  return signInWithPopup(auth, provider)
}
export async function resendVerification(auth: Auth) {
  requireLocalAuth(auth)
  if (!auth.currentUser) throw new Error('Sign in before requesting verification.')
  if (!auth.currentUser.emailVerified) await sendEmailVerification(auth.currentUser)
}
export async function refreshVerification(auth: Auth) {
  requireLocalAuth(auth)
  const user = auth.currentUser
  if (!user) throw new Error('Your session has ended. Please sign in again.')
  await reload(user)
  await user.getIdToken(true)
  return user.emailVerified
}
export async function resetPassword(auth: Auth, email: string) {
  requireLocalAuth(auth)
  await sendPasswordResetEmail(auth, email.trim())
}
export async function logout(auth: Auth) {
  requireLocalAuth(auth)
  await signOut(auth)
}
export function friendlyAuthError(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  const messages: Record<string, string> = {
    'auth/invalid-credential': 'The email or password is incorrect.',
    'auth/invalid-login-credentials': 'The email or password is incorrect.',
    'auth/wrong-password': 'The email or password is incorrect.',
    'auth/user-not-found': 'The email or password is incorrect.',
    'auth/email-already-in-use': 'An account already uses this email. Sign in or reset your password.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/weak-password': 'Choose a stronger password with at least 8 characters.',
    'auth/too-many-requests': 'Too many attempts. Please wait before trying again.',
    'auth/network-request-failed': 'Cannot reach authentication. Check your internet connection, or start the emulators if emulator mode is selected.',
    'auth/popup-closed-by-user': 'The sign-in window was closed. You can try again.',
    'auth/popup-blocked': 'Allow the sign-in popup in your browser, then try again.',
    'auth/cancelled-popup-request': 'Finish the other sign-in window or try again.',
    'auth/account-exists-with-different-credential': 'This email uses another sign-in method. Sign in with that method first.',
    'auth/operation-not-allowed': 'This sign-in method is disabled in Firebase Authentication. Check Sign-in method in the selected Firebase project.',
    'auth/unauthorized-domain': 'This browser domain is not authorized for Firebase sign-in. Check Authentication → Settings → Authorized domains for localhost or 127.0.0.1, matching the address you opened.',
    'auth/auth-domain-config-required': 'The Firebase authentication domain is missing. Check VITE_FIREBASE_AUTH_DOMAIN and restart the development server.',
    'auth/operation-not-supported-in-this-environment': 'Google popup sign-in is not supported in this browser. Open the local preview in Chrome or Edge.',
    'auth/user-disabled': 'This account is disabled.',
    'auth/web-storage-unsupported': 'This browser cannot save your login session. Allow local browser storage or try another browser.',
    'permission-denied': 'Workspace access was denied. Your account must be verified and the selected database rules must permit your own workspace. No data was changed by this request.',
    'firestore/permission-denied': 'Workspace access was denied. Your account must be verified and the selected database rules must permit your own workspace. No data was changed by this request.',
    'unavailable': 'The selected database is unavailable. Check your connection and selected Firebase mode.',
    'firestore/unavailable': 'The selected database is unavailable. Check your connection and selected Firebase mode.',
  }
  return messages[code] ?? (error instanceof Error && !code ? error.message : 'Something went wrong. Please try again.')
}
