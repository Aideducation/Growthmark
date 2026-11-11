import { getApp, getApps, initializeApp } from 'firebase/app'
import { browserLocalPersistence, connectAuthEmulator, getAuth, setPersistence } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { registerLiveFirebase, useFirebaseEmulators } from './firebase-mode'

function required(name: string, value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error(`Missing ${name}. Add your Firebase Web configuration to .env.local and restart Vite.`)
  }
  return value.trim()
}

export const isEmulatorMode = useFirebaseEmulators(import.meta.env.VITE_USE_FIREBASE_EMULATORS)
const firebaseConfig = isEmulatorMode ? {
  apiKey: 'demo-emulator-only', authDomain: 'localhost', projectId: 'demo-growthmark-security',
  storageBucket: 'demo-growthmark-security.firebasestorage.app', messagingSenderId: '000000000000', appId: 'demo-growthmark-web',
} : {
  apiKey: required('VITE_FIREBASE_API_KEY', import.meta.env.VITE_FIREBASE_API_KEY),
  authDomain: required('VITE_FIREBASE_AUTH_DOMAIN', import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: required('VITE_FIREBASE_PROJECT_ID', import.meta.env.VITE_FIREBASE_PROJECT_ID),
  storageBucket: required('VITE_FIREBASE_STORAGE_BUCKET', import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: required('VITE_FIREBASE_MESSAGING_SENDER_ID', import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID),
  appId: required('VITE_FIREBASE_APP_ID', import.meta.env.VITE_FIREBASE_APP_ID),
}

// Isolate development persistence from real-project app instances and sessions.
const appName = isEmulatorMode ? 'growthmark-local' : 'growthmark-web'
const existingApp = getApps().find(app => app.name === appName)
if (existingApp && Object.entries(firebaseConfig).some(([key, value]) => existingApp.options[key as keyof typeof firebaseConfig] !== value)) {
  throw new Error('Firebase configuration changed. Fully reload the browser to use the selected project.')
}

export const firebaseApp = existingApp ? getApp(appName) : initializeApp(firebaseConfig, appName)
export const auth = getAuth(firebaseApp)
export const db = getFirestore(firebaseApp)
export const storage = getStorage(firebaseApp)

if (isEmulatorMode && !existingApp) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}
if (!isEmulatorMode) registerLiveFirebase(auth, db)
// Storage uploads and Analytics remain outside this integration.
export const authPersistenceReady = setPersistence(auth, browserLocalPersistence)
