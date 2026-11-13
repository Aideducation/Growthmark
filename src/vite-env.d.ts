/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_NUMBERED_INVOICES?: string
  readonly VITE_INVOICE_CANDIDATE_PREVIEW?: string
  readonly VITE_USE_FIREBASE_EMULATORS?: string
  readonly VITE_FIREBASE_API_KEY: string
  readonly VITE_FIREBASE_AUTH_DOMAIN: string
  readonly VITE_FIREBASE_PROJECT_ID: string
  readonly VITE_FIREBASE_STORAGE_BUCKET: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string
  readonly VITE_FIREBASE_APP_ID: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
