# Vercel deployment preparation

No deployment, Git push, Firebase Console change, live data write, billing change or Firebase rules publication was performed. Existing application modules and `.env.local` were not edited.

## Readiness

- Local Firebase configuration names `growthmark-c0e9c` and auth domain `growthmark-c0e9c.firebaseapp.com`; all six Web SDK values are present.
- `vercel.json` selects Vite, `npm ci`, build command `npm run build:vercel`, and output directory `dist`.
- The deployment build refuses missing/true emulator flags, missing/placeholder configuration, a project other than the approved project, localhost Auth domains and obvious private credentials in public VITE variables. It validates the destination rather than replacing the project ID. Both Auth and Firestore use the same selected real app.
- Normal local `npm run dev` and `npm run build` retain the existing emulator-default behaviour. Use the guarded `build:vercel` command for hosting, and do not replace the Vercel Build Command with the ordinary local build command.
- Existing hash routes such as `/#invoices` and `/#settings` work with static hosting. The fragment is not sent to the server, so no SPA rewrite is required. Asset and font paths stay at `/assets/` and `/fonts/`. Do not change URLs to `/invoices`; that is not an existing application route.
- There is currently no Git repository in this folder. Ignore patterns protect future staging, but cannot undo a past upload elsewhere. A pattern scan found an old emulator Auth export containing password-hash/account data; that export is now ignored. No matching service-account/private-key material was found in application source/public assets or the production output. This is a targeted check, not a guarantee about every possible secret format.
- `.gitignore` and `.vercelignore` exclude `.env.local`/other env files (except the safe template), emulator exports, recovery backups, local Vercel metadata, common service-account/key files, dependencies, caches and test output. Nothing was deleted. `public/` contains only the PDF font and its license.
- Official invoice issuance, public links, invoice payment verification and other pending features remain disabled.

## Hosting plan limitation

Vercel Hobby is for personal, non-commercial use. A commercial freelancer-management SaaS/business application may not qualify, even if free to its users. Confirm eligibility before choosing Hobby; do not assume zero traffic makes commercial use eligible. No paid plan was enabled.

Reference: https://vercel.com/docs/plans/hobby

## Environment variables to add in Vercel

Use **Project Settings → Environment Variables**, or the Environment Variables section before the first deployment. Apply the values to Production and to Preview if Preview builds will be used. These are browser configuration, not server credentials. Get the six current values from Firebase → Project settings → General → Your apps → GrowthMark Web → SDK configuration. Keep `.env.local` on your computer.

| Variable | Value |
|---|---|
| VITE_USE_FIREBASE_EMULATORS | `false` |
| VITE_FIREBASE_API_KEY | Copy the existing Web app API key |
| VITE_FIREBASE_AUTH_DOMAIN | `growthmark-c0e9c.firebaseapp.com` |
| VITE_FIREBASE_PROJECT_ID | `growthmark-c0e9c` |
| VITE_FIREBASE_STORAGE_BUCKET | `growthmark-c0e9c.firebasestorage.app` |
| VITE_FIREBASE_MESSAGING_SENDER_ID | Copy the existing sender ID |
| VITE_FIREBASE_APP_ID | Copy the existing Web app ID |

No measurement ID, Admin SDK JSON, Firebase CLI token, service-account credential or private key is required. All VITE variables are included in browser code. Environment changes require a new build/deployment to take effect; changing a Vercel variable does not update an already-built page.

## Firebase prerequisites — not completed by this preparation

1. Review the **actual deployed** Firestore rules for `growthmark-c0e9c`. The last confirmed live policy was deny-all; no live rule inspection was performed in this preparation. Agency/invoice rules were approved/applied only to the LOCAL emulator. A local approval is not production publication approval.
2. Obtain separate approval for the production rules and test their intended private-draft scope. They do not make invoice totals authoritative or enable issued-invoice finance features. Workspace operations will fail if the live rules remain deny-all.
3. In Authentication → Sign-in method, verify Email/Password and Google are enabled for the real project. Emulator success does not verify either live provider. For Google, verify the support email/OAuth configuration.
4. After choosing the stable Vercel project hostname, add that **exact hostname** (for example `your-project.vercel.app`, without https:// or a path) under Firebase Authentication → Settings → Authorized domains. That example is a placeholder, not an assigned URL. Keep the Web SDK authDomain as `growthmark-c0e9c.firebaseapp.com`; do not blindly replace it with the Vercel hostname.
5. Preview deployment hostnames may differ and need their own authorization if used for sign-in. Prefer one stable approved hostname for initial manual testing.

Google readiness is therefore **unverified for the deployed domain**, not confirmed working. These checks do not require Blaze, but must be performed with explicit authorization to change settings when needed.

Reference: https://firebase.google.com/docs/auth/web/google-signin

## Exact publishing sequence, once launch prerequisites are approved

1. Confirm Hobby eligibility for your intended use. Resolve production Firebase rule/provider approval before inviting real users.
2. Create a clean **private GitHub repository** from this folder. Review the pending files before the first commit: `.env.local`, `firebase-export-*`, `auth_export`, `.tools`, `.cache`, rules `.bak` files and generated test results must not appear. This repository creation/push has not been performed. A later assisted step can handle it without uploading private files.
3. In Vercel choose **Add New → Project**, import that repository, and leave Root Directory at the repository root. Select **Vite**. Confirm Build Command `npm run build:vercel`, Output Directory `dist`, Install Command `npm ci`. Use a supported Node version compatible with Vite 7 (22.12+ on Node 22, or a supported newer release).
4. Add the seven environment variables above before starting the deployment. Choose a project name; Vercel will assign its available `.vercel.app` hostname. No domain purchase is necessary.
5. Complete the separately authorized Firebase domain/provider checks for that hostname. Do not run `firebase deploy` as part of Vercel deployment.
6. Only when explicitly ready to publish, click **Deploy**. That action makes a hosted deployment and was deliberately not performed here. Future Git pushes can trigger deployments automatically after the integration is connected.
7. Open Vercel's actual assigned URL. Confirm the login footer says `Real Firebase mode · growthmark-c0e9c`. Test Email/Password registration/verification, Google sign-in, returning-user login, refresh/logout, UID-owned onboarding and two-user isolation. Test Settings/Agency saves and invoice drafts after the approved live rules are in place.

Local emulator accounts/data remain local. Vercel deployment does not transfer, restore or migrate them into real Firebase. Seeing a new live workspace is expected if the account existed only in the emulator; resolve recovery separately rather than overwriting accounts.

## Checks performed

- `node --test tests/security/deployment-build.test.mjs`: **3 passed, 0 failed**.
- `node scripts/build-vercel.mjs --check` with default local settings: rejected as expected because no explicit real-mode flag was supplied.
- `npm run build:vercel` with a process-local `VITE_USE_FIREBASE_EMULATORS=false`: TypeScript and production build passed for `growthmark-c0e9c`. The shell variable was restored afterward; `.env.local` is unchanged.
- Local production preview at `127.0.0.1:5182/#invoices`: login screen rendered in Real Firebase mode with the correct project and normal Google button. No sign-in/registration was performed and no live data was created. The code's shared mode branch selects no Auth/Firestore emulator connections or emulator health polling in this build.
- Ignore-pattern checks passed for local env files, emulator export/account records, rules backup, Vercel metadata and example credential files; `.env.example` remains included.
- Existing bundle-size warning remains: main bundle exceeds 500 KB. This does not fail the build. Live OAuth, live rules/Firestore operations and Vercel-hosted routing cannot be fully verified before the final hostname/settings are available.

Only deployment/preparation files changed: `vercel.json`, `.vercelignore`, `.gitignore`, `.env.example`, `package.json`, `scripts/build-vercel.mjs`, `tests/security/deployment-build.test.mjs`, and this document. `dist/` was regenerated locally as ignored build output. No existing application module, Firebase config or security-rule file was modified.

References: https://vercel.com/docs/frameworks/frontend/vite · https://vercel.com/docs/environment-variables · https://vite.dev/guide/env-and-mode.html
