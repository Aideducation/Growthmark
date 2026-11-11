# Selecting Firebase mode

Default: emulator mode, even in builds when the flag is omitted. `.env.local` has not been changed. Keep its six existing Firebase values.

## Emulator mode

Set `VITE_USE_FIREBASE_EMULATORS=true` in `.env.local` (or omit it). Run `npm.cmd run emulators`, then in another terminal `npm.cmd run dev`. Auth uses 127.0.0.1:9099 and Firestore uses 127.0.0.1:8080 with the existing demo-growthmark-security namespace. Unavailable emulators never fall back to live services.

## Real Firebase mode

Set `VITE_USE_FIREBASE_EMULATORS=false` in `.env.local`. Keep existing Firebase values; `VITE_FIREBASE_PROJECT_ID` should be `growthmark-c0e9c`. Stop Vite with Ctrl+C, restart `npm.cmd run dev`, then fully reload the browser. The login screen names the real project. Auth and Firestore both use the environment configuration. No real project ID is hardcoded or substituted.

Real registration/sign-in can create real Auth users. Workspace and module operations use real Firestore subject to deployed rules. If rules are still deny-all, workspace access fails with permission denied. Enabled providers, authorized domains and reviewed live rules are separate prerequisites. This change does not modify those settings or publish rules. Never weaken rules to bypass an error.

Switch back with `true`, restart Vite and fully reload. Separate named Firebase apps isolate sessions. Switching modes does not transfer accounts or data; the same email can have different UIDs. Missing data must not be recovered by recreating workspaces.

Emulator startup currently has no automatic export/import. Preserve data before restarting emulators; changing modes only needs a Vite restart. Invalid flags stop initialization. Builds capture the flag at build time. VITE values are public browser configuration: never store service-account credentials or server secrets here.

Validation: `node --test tests/security/firebase-mode.test.mjs` checks selection defaults and paired-instance guards without network access. `npm.cmd run test:security` runs the existing isolated emulator suite. Real-provider sign-in and live database permissions require separate manual testing; a successful build does not verify those settings.
