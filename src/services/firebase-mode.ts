import type { Auth } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'

export function useFirebaseEmulators(value: string | undefined): boolean {
  if (value === undefined || value.trim() === '' || value.trim() === 'true') return true
  if (value.trim() === 'false') return false
  throw new Error('VITE_USE_FIREBASE_EMULATORS must be true or false.')
}

// Only the central initializer can authorize a live Auth/Firestore pair.
const livePairs = new WeakMap<Auth, Firestore>()
export function registerLiveFirebase(auth: Auth, db: Firestore) {
  if (auth.emulatorConfig || auth.app !== db.app || !auth.app.options.projectId || auth.app.options.projectId.startsWith('demo-')) {
    throw new Error('Invalid real Firebase configuration. Reload the application.')
  }
  livePairs.set(auth, db)
}
export function isSelectedLiveAuth(auth: Auth): boolean { return livePairs.has(auth) && !auth.emulatorConfig }
export function requireMatchingFirebase(auth: Auth, db: Firestore) {
  if (auth.app !== db.app || (isSelectedLiveAuth(auth) && livePairs.get(auth) !== db)) {
    throw new Error('Authentication and database must use the same selected Firebase app and mode.')
  }
}
