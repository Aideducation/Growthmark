# Spark-first Stage 1 — local security preparation

This document supersedes the backend-only write/provisioning portions of `architecture.md` for Stage 1. The larger Stage 2 design remains a direction, not implemented functionality. Live Firestore rules are unchanged. Only `firebase.emulator.json` loads the local `firestore.rules`; no default `firebase.json` or real project alias is created.

## Identity and provisioning

Email/Password and Google identities require the Firebase Auth token's verified email claim. Phone OTP is not part of Stage 1. Workspace IDs equal the owner UID. `users/{uid}` points to `workspaces/{uid}`. Initial profile and workspace must commit together; mutual `getAfter()` checks reject half-provisioned signup. Own absent documents can be read during signup transactions. No user-controlled roles, permissions or verification flags exist.

`accountAccess/{uid}` is an optional trusted override. Absence permits verified signup/use; an existing override must have matching `userId` and `status: active`. Suspended or malformed overrides deny access. Clients can get their own status but cannot list or write these documents. This is not an admin interface; Stage 2 operations are not implemented.

## Exact Stage 1 document fields

All workspace subcollection documents (including items and settings) require this envelope: `schemaVersion: 1`, `workspaceId: uid`, `ownerId: uid`, `createdAt: Timestamp`, `updatedAt: Timestamp`, `revision: integer`. Creation timestamps use `serverTimestamp()` and revision 1. Updates preserve creation time/owner/workspace/schema, use `serverTimestamp()` and increment revision by exactly 1. Extra fields and omitted required fields are denied. Empty strings represent unset optional textual values. Optional dates/references are null, not omitted.

| Path | Fields in addition to envelope |
| --- | --- |
| `clients/{id}` | name, company, email, phone, whatsapp, address, services, notes, status (active/inactive/archived) |
| `projects/{id}` | immutable clientId, name, description, serviceCategory, budgetMinor (integer), nullable startAt/deadlineAt, status, progressPercent (integer 0–100), notes |
| `tasks/{id}` | nullable clientId/projectId, title, description, priority, nullable dueAt, status (todo/in-progress/completed/cancelled) |
| `settings/business` | name, businessType, industry, email, phone, whatsapp, website, street, city, state, country, postalCode, gstin |
| `settings/payment` | upiId, accountHolder, bankName, accountNumber, ifsc, instructions (all private strings) |
| `settings/invoice` | invoicePrefix, quotationPrefix, paymentTermsDays (integer 0–365), footer, thankYouMessage, defaultTaxBps/defaultDiscountBps (integers 0–10000) |
| `quotations/{id}`, `invoices/{id}` | immutable clientId, nullable projectId, title, state (draft/archived), issueAt, nullable dueAt, terms, notes |
| `quotations/{id}/items/{id}`, `invoices/{id}/items/{id}` | description, quantityMilli (integer 1–1,000,000,000), unitPriceMinor (integer 0–1,000,000,000,000), taxRateBps/discountBps (integers 0–10000) |
| `payments/{id}` | clientId, nullable projectId, amountMinor (positive bounded integer), currency, paidAt, method, transactionReference, notes, source (owner-recorded only) |

Workspace-relative paths above sit under `workspaces/{uid}`. All currencies derive from the workspace currency. QuantityMilli 1000 means one unit; basis points 10000 means 100%. Use exact decimal/integer arithmetic in future draft previews; these rules do not calculate authoritative document totals.

Root `users/{uid}` fields: schemaVersion, userId, workspaceId, fullName, email, phone, whatsapp, createdAt, updatedAt. IDs must equal UID; email must equal the Auth token email. Authenticated identity is authoritative; editing the profile cannot change email verification.

Root `workspaces/{uid}` fields: schemaVersion, ownerId, name, currency, timezone, onboarding, createdAt, updatedAt. Currency (INR/USD/EUR/GBP) is immutable. Onboarding is business-profile/complete and is only a UI progress marker, never authorization. The browser must validate IANA timezone choices; rules currently bound its text length and non-emptiness.

Frontend design contracts use ISO dates, nested addresses, upload references and later-stage snapshots. They are not Firestore serializers. Phase 2 now provides an explicit profile/workspace adapter in `workspace-service.ts`; other business/settings adapters remain future work. Do not write those other contract objects directly to Firestore.

## Relationships and draft locks

References resolve only under the owner's workspace. Linked project/client pairs must agree. Project clients cannot be reassigned; draft client references are immutable. Projects enforce deadline >= start date when both exist. Drafts enforce due date >= issue date. Client/project records are archived rather than deleted.

Draft parents can be archived but not reactivated or edited afterward. Items can be edited/deleted only when the parent is draft before AND after the commit. This rejects archive-plus-item-change batches. A draft parent must already exist before adding items; initial parent and items are separate commits. No issued numbers, persisted totals, snapshots, paid status, gateway verification or public links are accepted.

## Payment restrictions

Entries are append-only owner assertions. Rules reject edits, replacements, deletions, nonpositive/fractional amounts, future payment dates, wrong currency and invented gateway verification. Method is upi/bank-transfer/cash/other. Payment references must match local clients/projects. They do not settle draft invoices.

Use one stable document ID per payment submission and a transaction that returns the existing record on retries. The suite exercises concurrent retries for one ID. A different ID can still duplicate the same real-world payment; no independent bank verification is claimed. Advanced corrections and financial audit controls remain Stage 2.

## Closed paths and later features

All public, admin, financial-control, unknown, and arbitrary deeper subcollection paths are denied. The Stage 1 rules intentionally grant no super-admin access, even for a simulated admin claim. Private bank settings have no public read route. Settings enumeration is denied; fetch only the three known document IDs.

Storage uploads, real SMS, deployment, numbering, public invoice endpoints, payment gateway webhooks, background jobs and admin operations are outside this phase. None are enabled by local emulator testing.

## Local execution and evidence

Run `npm run test:security`. See `tests/security/README.md` for guards, prerequisites, test coverage and limits. The runner saves actual results under ignored `tests/security/results/latest.txt`. The test suite requires loopback Auth and Firestore emulators and `demo-growthmark-security`; it does not import `.env.local` or `src/services/firebase.ts`.

Future changes to rule permissions need new positive and negative tests. Never publish these local rules merely because the emulator can start; require successful test execution and separate approval first.
