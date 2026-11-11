# GrowthMark

Freelancer business management platform built with React, TypeScript, Vite, Tailwind CSS v4 and Lucide icons. The local app now has all eleven module pages, connected client/project/task management, draft documents/PDFs, manual payments, private settings and actual-record reports. Clients are records, not login users. Live authentication and deployment remain disabled. See [module status and executed checks](docs/module-status.md) for functional boundaries and pending features.

## Run locally

1. Install Node.js and run `npm install` in this folder.
   On a fresh checkout, copy `.env.example` to `.env.local` and replace placeholders with your Firebase Web app configuration. The current local workspace is already configured for the authorized new project. Never add private keys. Restart Vite after changing environment variables.
2. Run `npm run emulators` to start the demo Auth/Firestore services. In another terminal run `npm run dev` and open the local address printed by Vite. Emulator mode is the default. To explicitly select real Firebase, follow [Firebase mode instructions](docs/firebase-modes.md).
3. Use the moon/sun button in the header to switch themes. Light is the first-visit default; the browser remembers your choice.

## Checks

`npm run build` checks TypeScript and builds the app into `dist`. `npm run preview` previews that local build. Neither command deploys anything.

`npm run test:security` runs the local Auth/Firestore suite using only `demo-growthmark-security-tests` on separate ports. It does not use the live project or clear the development workspace. See [the security test instructions](tests/security/README.md) and [the Stage 1 schema](docs/stage1-firestore.md). Live Firestore rules remain deny-all until separately reviewed and authorized.

Development emulators can remain running during automated tests. Tests clear only their isolated test demo fixtures. Verification/reset emails appear as local links in the development emulator terminal, not a real inbox. See [Phase 2 instructions](docs/phase2-authentication.md) and the newer [module expansion notes](docs/module-status.md).

## Structure

- `src/app/layouts`: responsive workspace shell.
- `src/components`: reusable interface pieces.
- `src/styles.css`: stylesheet entry; `src/styles` holds theme tokens, layout and control foundations.
- `src/domain`: identity and ownership contracts.
- `src/features`: dashboard, local authentication/onboarding, workspace module pages and protected record services.
- `src/services`: Firebase SDK initialization and future integration boundaries.
- `docs/architecture.md`: security boundaries, database design, open decisions and phase gates.
- `docs/design-system.md`: shared theme and accessibility conventions.

The dashboard describes setup readiness; it does not show invented customer or financial data. It displays the authenticated emulator workspace name and a local-emulator status. TypeScript contracts are not security enforcement. Live authentication, rule publication and backend financial validation require separate authorization. Real OTP, hosted Firebase Storage and deployed Cloud Functions need a separate billing decision. Nothing enables billing or deployment. `.env.local` is excluded from Git; Vite configuration values still become visible in browser code. No Analytics is initialized.
