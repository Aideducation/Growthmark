# Phase 2 — local authentication and workspace onboarding

> Module expansion update: automated tests now use a separate demo project/ports and can run alongside development. The old shared-port instructions below describe the original Phase 2 setup. See [module-status.md](module-status.md) for current module behavior and the 110-test run.

## Implemented

- Email/password registration and login, Google popup sign-in, verification resend/check, password reset requests, logout and browser-local persistent login.
- Auth gate: signed out → verification required → onboarding → dashboard. Loading, error and unavailable-account screens do not render workspace content.
- Owner name and business name onboarding. Default currency INR and timezone Asia/Kolkata; logo uploads remain deferred.
- Profile/workspace provisioning in a Firestore transaction, using only the Auth UID as both document IDs. No owner/workspace ID is accepted from the form.
- Validation of stored ownership/schema before returning records to React.
- Concurrent/repeated completed onboarding returns existing records without replacing names or creation timestamps. An existing business-profile onboarding state can be completed without changing creation timestamps.
- Existing dashboard layout/navigation/theme preserved. Workspace and owner labels are personalized, logout is available in the header, and the Firebase setup label accurately identifies local emulators.
- Session changes invalidate pending workspace loads. The provider watches the server-controlled access override and removes workspace access on suspension. No persistent Firestore disk cache is enabled.

## Local-only connection

Vite development builds use the named Firebase app `growthmark-local` and fixed project `demo-growthmark-security`. Auth is connected to `127.0.0.1:9099`; Firestore is connected to `127.0.0.1:8080` before either is used. The real `.env.local` configuration is not used for development authentication or data operations.

The mutation service rejects Auth instances that are not attached to the exact demo Auth emulator, and the workspace service checks that Auth/Firestore project IDs agree. Firestore Security Rules remain the actual authorization boundary. No live provider is enabled, no live rules are published, and no live records are created.

Production builds retain the existing environment-based SDK configuration but show a live-sign-in-disabled screen. Actual live sign-in/CRUD is intentionally unavailable until separately authorized, configured and tested. Do not interpret a successful production build as a production-ready authentication rollout.

## Files

- `src/features/auth/auth-api.ts`: local-only Firebase Auth operations and user-friendly errors.
- `src/features/auth/workspace-service.ts`: verified UID-derived workspace read/provisioning transactions and schema adapters.
- `src/features/auth/contracts.ts`: session/onboarding interfaces; no phone-OTP API.
- `src/features/auth/auth-context.ts`: stable shared context and hook.
- `src/features/auth/AuthProvider.tsx`: persistence readiness, token/session lifecycle, access watcher and stale-response protection.
- `src/features/auth/AuthGate.tsx`: forms, verification and onboarding screens.
- `src/services/firebase.ts`: separate local app and emulator connectors.
- `src/styles/auth.css`: responsive theme-aware auth styling.

## Starting the local app

1. `npm run emulators` starts the local Auth/Firestore demo emulators and leaves them running.
2. In another terminal, `npm run dev` starts the existing Vite app. Open the URL Vite prints.
3. Register a disposable account. Emulator emails are not delivered to an inbox: verification/reset links appear in the emulator terminal and in ignored `tests/security/results/development-emulators.txt`.
4. Open the verification link, return to GrowthMark, select “I’ve verified my email”, and complete business onboarding.

The local emulator database is temporary. Restarting it without an export/import workflow clears its data; an old browser-local session may need signing out and registering again. Do not enter real passwords or private business records into disposable test accounts.

Stop the development emulators before `npm run test:security`; the suite starts its own instances on the same ports and deliberately clears demo fixtures. Do not run the suite against an active manual demo you want to preserve.

## Executed validation

`npm run test:security` actually executed **96 tests: 96 passed, 0 failed, 0 skipped**. This includes the original 82 tests and 14 new tests importing the same TypeScript application auth/onboarding services used by React. Output: ignored `tests/security/results/latest.txt`.

Additional service coverage: real emulator registration/verification; refused unverified onboarding; concurrent/repeated provisioning; injected UID/admin properties; fresh-client login; invalid names; suspended accounts; invalid stored ownership; resumed onboarding; usable password reset code and new-password login; Google-provider credential onboarding; and logout protection. The runner starts and stops only the demo Auth/Firestore emulators.

Browser checks actually performed:
- Two independent email/password accounts registered and verified via local emulator links.
- Verification gate blocked entry before verification.
- Owner/business onboarding completed and displayed the right identity.
- Refresh retained authenticated workspace access; logout plus refresh remained signed out.
- Wrong-password error and password-reset success feedback displayed correctly.
- Switching from B back to A displayed A's workspace with no B identity left in the visible page.
- Desktop/tablet/mobile auth layouts, mobile dashboard navigation, both themes and horizontal overflow checked.
- Final fresh-tab login, refresh and logout completed with no captured console errors.

Browser testing caught and corrected a collapsed heading space on mobile and a Fast Refresh context-identity error. Separating the shared context/hook from the provider component resolved the hot-reload issue; the fresh-tab flow was then rechecked.

## Remaining limitations

- The embedded preview browser did not produce an accessible Google popup. The Google SDK/provider-token onboarding tests pass, but complete popup interaction was NOT verified in that browser. Popup guidance and a cancel/reload action are provided. Real Google OAuth/consent also remains untested because live providers are unchanged.
- Persistent login was checked across browser refresh and a fresh local client, not an operating-system/browser restart.
- Real email delivery, phone OTP, uploads, client logins, business-module CRUD screens, financial issuance/public links, backend services and admin operations are not implemented by this phase.
- No rule changes were needed; the previously tested local rules are reused unchanged.
- Production build still reports the existing large-JavaScript-chunk warning. Bundle optimization is separate from correctness and has not been hidden by changing warning limits.
- Dev CLI dependency deprecation/Node-26 compatibility warnings remain from the prior setup; executed emulator tests succeeded.
