# GrowthMark architecture — approved Phase 1

> Stage 1 update: the approved Spark-first database/write policy and tested local rule schema are documented in [stage1-firestore.md](stage1-firestore.md). That document supersedes the backend-only provisioning/write portions below for Stage 1. Live Firebase rules remain unchanged; Stage 2 backend features are still deferred.

GrowthMark is a freelancer business management platform, not a sales CRM or client portal. Clients are private business records and never receive accounts. Phase 1 is a disconnected local interface foundation, not a secure multi-tenant application yet.

## Current boundaries

- `src/app/layouts`: shared workspace shell and responsive navigation.
- `src/features/dashboard`: existing setup overview; no fabricated business statistics.
- `src/features/auth/contracts.ts`: future authentication adapter and explicit session states.
- `src/domain/identity.ts`: identity, workspace and record contracts.
- `src/features/settings/contracts.ts`: independent business/payment/invoice settings and issued identity snapshot.
- `src/components`: reusable components, including the existing theme toggle.
- `src/styles`: semantic theme tokens, existing layout and shared control styles.
- `src/services`: documentation of future integration boundaries; no adapter is connected.

Only the theme preference is stored locally. No private business data, credentials or simulated login session is stored in the browser. Existing `#dashboard` and `#setup` anchors remain available. Future route families are `/app/*`, `/auth/*`, `/pay/:token`, a public quotation route and `/admin/*`; they are design proposals, not implemented routes. No placeholder links claim that unavailable modules work.

## Identity and onboarding

One authenticated owner receives one workspace. A trusted repeat-safe operation creates `users/{uid}` and the workspace association after the required verification. Auth and Firestore cannot be committed in one shared transaction: interrupted signup must resume provisioning safely, without duplicate workspaces. The server enforces the unique user-to-workspace mapping.

Email/password is the primary login. Link phone verification to that identity instead of creating another account. Password input is transient and goes only to Firebase Authentication. A user-written phone field is not evidence of verification. Session states include disconnected, loading, signed out, verification required, onboarding, ready, suspended and error. No frontend route guard is an authorization boundary.

Real OTP is not implemented or silently replaced with fake verification. Whether verification blocks entry must be decided before Phase 2. Firebase emulators are the preferred first integration environment; connecting any real project needs separate authorization, and an old project must not be reused.

## Ownership and access

`workspaces/{workspaceId}` holds immutable `ownerId`, creation timestamp, name, onboarding state, currency and timezone. Treat TypeScript `readonly` as a developer aid, not security: runtime validation, Security Rules and server checks must enforce immutability.

Use default-deny Firestore and Storage Rules. Check signed-in identity, server-controlled active status, owner, field allowlists, types and related records. Do not add a broad recursive owner write rule that accidentally permits changes to counters or payment-derived balances. Scope queries to the workspace; rules are not data filters.

The backend verifies identity and ownership independently because Admin SDK operations bypass client Security Rules. Ordinary users cannot change account access status or platform roles. Suspension blocks protected data, uploads and backend actions, including already-issued sessions. Super-admin roles are assigned only by a privileged server process. Admin screens expose minimal account metadata and aggregate usage, without default financial access.

## Planned database

Top level: `users`, `accountAccess`, `workspaces`, `publicLinks`, `platformAccounts`.

Workspace subcollections: `clients`, `projects`, `tasks`, `quotations`, `invoices`, `payments`, `retainers`, `notifications`, `files`, `counters`, `auditEvents`, `operationKeys`, `billingPeriods`, `reportSummaries`; settings documents: `business`, `payment`, `invoice`.

Each client/project/task relationship must reference records in the same workspace. Project and task client associations must agree. Ordinary draft editing can use constrained client writes. Issuance, payments, public links, counters, administrative actions and audit writes are backend-only.

## Financial invariants

Use currency-aware minor units and explicit tax/discount rounding. Validate safe numeric ranges and quantities on the server. The browser can preview calculations but is not authoritative. Never sum different currencies without an agreed conversion policy.

Issue documents in a transaction: check operation key, allocate unique workspace number, validate/recalculate the document, save immutable snapshots and append audit history. Preserve numbers on cancellation. Accepted quotation conversion needs its own duplicate-prevention key.

Snapshots include business identity, client-facing client details, selected payment information, branding, line items, calculations, terms and immutable asset versions. The Phase 1 snapshot type covers identity/settings only; complete financial models follow in Phase 5. Nested runtime immutability still needs enforcement.

Record payments atomically with balances and audit events. Duplicate request keys protect retries; gateway event IDs protect webhook repeats. Corrections use reversals/adjustments. Overdue state derives from due date, timezone and unpaid balance. Recurring generation requires confirmation and a unique retainer-period key.

## Public document access

Issue cryptographically random tokens and keep hash-to-document mappings server-only. A public endpoint returns an explicit field allowlist for one issued document. It cannot return complete private settings, other documents or owner-only notes. Public visitors cannot write, confirm payment or discover invoice collections.

Revoke/regenerate links through authenticated backend actions. PDFs and image access must respect the same policy. Do not serve a revocable page whose supposedly protected PDF remains permanently public. Already downloaded copies cannot be recalled. Avoid token logging, third-party trackers and indexing. Consider rate limiting, token lookup abuse and resource limits before release.

## Files and reports

Use workspace-prefixed Storage paths for profiles, branding, payment assets, clients, projects and issued-document versions. Validate size and file types; prevent overwriting assets referenced by issued invoices. Private file download tokens must not leak into public documents.

Reports use actual records or server-maintained summaries with reconciliations. Separate billed revenue and cash collections. Use pagination and bounded listeners to control reads. In-app due-date reminders can be calculated on app open initially; background delivery and automated WhatsApp are not implemented.

## Budget boundary

As checked during architecture review on 10 November 2026: real verification SMS, Firebase Storage and deployed Cloud Functions require Blaze. Firestore has shared project quotas. Local emulator development can precede a billing decision. No billing upgrade is authorized. Do not reduce backend validation to make a full production release fit Spark.

Official references:
- https://firebase.google.com/docs/auth/limits
- https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024
- https://firebase.google.com/docs/functions/get-started
- https://firebase.google.com/docs/firestore/quotas
- https://firebase.google.com/docs/firestore/security/rules-conditions

## Decisions before implementation of dependent features

- OTP gate versus a reduced email-only release; no silent requirement changes.
- Tax types, discount order, rounding, invoice numbering/reset policy and supported currencies.
- Owner-recorded quotation acceptance versus secure client acceptance.
- Overpayments, refunds, credits, cancellations and record retention.
- Account deletion/export, backup retention, restore objectives and region selection.
- Gateway provider and ownership of merchant accounts; platform subscriptions are not assumed.
- One owner only initially; staff roles and ownership transfer need a separate design.

## Phases and release gates

1. Local structure, design tokens and contracts (this phase).
2. Auth, resumed onboarding, workspace provisioning and two-account isolation tests.
3. Clients, projects, tasks and record-based dashboard.
4. Full business/branding/payment settings and uploads, subject to billing decision.
5. Quotation/invoice drafts, trusted issuance, snapshots and PDF verification.
6. Public links, revocation and client-facing payment instructions.
7. Payments, receipts, reversals and confirmed recurring periods.
8. Reports, exports, notifications and remaining files.
9. Super-admin controls and broader security review.
10. Backup/restore rehearsal, acceptance testing and separately approved deployment.

Rules tests start in Phase 2. Test anonymous/other-owner access, suspended sessions, forged roles, invalid references, concurrent issuance, retries, partial payments, duplicate periods, old snapshots after edits and revoked links. Test PDFs, keyboard use, mobile/tablet, both themes and logout cache clearing. Passing a frontend build alone never establishes production readiness.
