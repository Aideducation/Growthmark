# Service boundary

`firebase.ts` initializes Auth, Firestore and Storage. `VITE_USE_FIREBASE_EMULATORS` defaults to true. Explicit false selects real Firebase from the existing environment values. Auth and Firestore share one selected app; named apps separate sessions. See [mode instructions](../../docs/firebase-modes.md). No live providers, rules, records, uploads or deployment are changed by preparing this switch.

The authorized real project is `growthmark-c0e9c`; the local demo project is `demo-growthmark-security`. `.env.example` documents the six browser configuration values. `.env.local` is ignored by Git. Restart Vite after environment changes. Analytics is not initialized. Vite variables are public browser configuration and must never contain server credentials. The dashboard distinguishes local emulators from live services; it does not prove live connectivity.

The workspace adapter translates native Firestore timestamps to ISO timestamps and validates stored ownership. Other feature adapters remain future work. Types do not replace Security Rules or runtime validation. See `docs/phase2-authentication.md` for connection guards, local test results and remaining limits.

Browser operations may read owner-authorized records and edit allowed drafts. Issuance, payment recording, public-link creation/revocation, counters, account administration and audit writes belong to a trusted backend. Each backend operation verifies identity, active account status, workspace ownership, input and related records. Never accept owner identity from a form.

No browser adapter can grant itself admin claims or confirm gateway payments. Admin SDK credentials and gateway secrets must never enter `src` or Vite environment variables. No old Firebase project may be reused.
