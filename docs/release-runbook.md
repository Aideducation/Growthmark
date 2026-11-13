# GrowthMark release runbook — approval required before production actions

This is an implementation/release candidate, not permission to publish. The local validation must be read alongside docs/release-validation.md. No production records, counters, settings, IAM credentials or rules were changed during preparation. No commit, push or deployment was performed.

## What this release contains

Email/password authentication and verified private workspaces; existing modules; protected, numbered private draft invoices; six manual status labels; private original snapshots/payment overrides; safe uncertainty recovery; a trusted new-workspace provisioning endpoint; and an operator-only historical inventory/provisioning tool. Paid labels do not verify payment or create money records. Official issuance, public invoice links and payment gateways remain disabled. Retainers retain the existing unsaved planner functionality; no subscription service was introduced.

New protected invoices allow eight item records, including charges. Existing larger legacy invoices remain editable. No browser or Firestore permission bypass can create an unnumbered new invoice under the final rules. Production enablement is now independent of the development preview flag.

## Approvals and checks before publication

- Approve the complete `firestore.release.rules` file, including all existing modules and private override GET access. Do not publish the older baseline/read-compatibility proposal after activation.
- Verify the CURRENT deployed Firebase rules, project/database, Email/Password provider, email verification/reset action configuration and authorized domain `growthmark.pages.dev` through the Console. These live settings were not independently verified locally. No provider changes are proposed.
- Record the currently deployed Cloudflare version, rules and build settings. Arrange a maintenance window because old frontend versions cannot create new unnumbered invoices after the new rules are published. Existing records must not be reset, migrated or deleted.
- Approve a server-only provisioning identity/secret setup and historical counter provisioning. These are real production security/data actions and were not executed. Normal users still cannot initialize or reset counters directly.
- Confirm Spark and Workers Free quotas are sufficient. Free-tier exhaustion must fail closed; do not enable paid plans or automatic upgrades. Pages Functions use Workers Free request quotas, not Firebase Cloud Functions/Blaze: https://developers.cloudflare.com/pages/functions/pricing/ .

## Cloudflare Pages settings

Use the EXISTING Pages project, private GitHub repository `Aideducation/Growthmark`, branch `main`, repository root as root directory, build command **`npm run build:cloudflare`**, output directory **`dist`**, and Node **24** (`.node-version` is included). Do not create another project or buy a domain. The existing `https://growthmark.pages.dev` subdomain is sufficient.

Functions are loaded from the repository's root `functions/` directory by the Pages Git integration. `public/_routes.json` limits Functions invocation to `/api/*`, leaving static pages/assets static. The endpoint is `/api/workspace`; hash routes such as `/#clients` retain their existing URLs. No Vercel rewrite is required. Check Functions quota behaviour is **fail closed**, not a static success fallback. Do not publish a `dist`-only static upload: it would omit the trusted endpoint.

Production browser/build variables (Firebase values come from the EXISTING Web app configuration):

| Variable | Value |
|---|---|
| `NODE_VERSION` | `24` |
| `VITE_USE_FIREBASE_EMULATORS` | `false` |
| `VITE_INVOICE_CANDIDATE_PREVIEW` | `false` |
| `VITE_ENABLE_NUMBERED_INVOICES` | `true` for release; `false` for compatible creation disablement |
| `VITE_FIREBASE_PROJECT_ID` | `growthmark-c0e9c` |
| `VITE_FIREBASE_API_KEY` | Existing Firebase Web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Existing Firebase Web Auth hostname |
| `VITE_FIREBASE_STORAGE_BUCKET` | Existing registered bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Existing sender ID |
| `VITE_FIREBASE_APP_ID` | Existing Web app ID |

The normal `vite build` path also runs the environment guard. It rejects emulator/candidate flags, an unexpected project, private `VITE_` credentials and missing explicit workflow mode. `.env.local` remains local and must never be uploaded. Do not use public Cloudflare preview deployments to validate production records; disable automatic branch previews unless a separately approved safe setup exists.

Server-only **Functions bindings**, configured only after approval:

| Binding | Purpose |
|---|---|
| `FIREBASE_PROJECT_ID` | `growthmark-c0e9c` |
| `FIREBASE_WEB_API_KEY` | Same public Web API key, used by Google to validate caller ID tokens |
| `FIREBASE_SERVICE_ACCOUNT` | Encrypted Cloudflare SECRET containing a dedicated server service-account JSON; NEVER prefix with `VITE_`, put in Git, put in `.env.example`, or paste into a chat |
| `WORKSPACE_PROVISIONING_ENABLED` | `true` only after configuration/review |
| `WORKSPACE_NEW_ACCOUNTS_AFTER` | Explicit UTC launch cutoff, ISO format, for example the actual approved launch time; do not use a fabricated old date |

An authorized project administrator must approve/create the dedicated provisioning identity and configure its encrypted secret directly in Cloudflare. Use only necessary Firestore data permissions (a reviewed custom role where possible; Cloud Datastore User is broader), never project Owner/Editor/Firebase Admin. The HTTP endpoint needs no Firebase Authentication administrator permissions, no Storage permissions and no account suspension-write permissions. It validates the user's token through Google's Auth REST API, checks active verified identity and uses only that UID. No UID/role/counter value is accepted from the request. Its server code only creates absent workspace records atomically; it cannot reset an existing counter through this endpoint.

Service-account creation/key management and IAM are pending production-only approvals, not locally simulated credentials. A short-lived/workload identity alternative can be reviewed separately. No key was created during this task. If a key is approved, keep downloaded files outside this repository, rotate/revoke them through the administrator, and never include them in the frontend, GitHub or build variables beginning with `VITE_`.

New verified accounts created after the cutoff receive profile, workspace, initial business settings, invoice preferences and a zero-baseline counter in one create-only atomic commit. Missing root records with orphan history, old accounts, partial records or existing workspaces without counters never receive a blind zero. Existing users retain their workspace and enter inventory review for numbering, not subscription/manual account approval. The endpoint fails clearly if bindings are unavailable and never falls back to creating an unprotected workspace. Uncertain onboarding commits are retried with the same UID; contention has a maximum of three fresh attempts.

The new-workspace write is a create-only atomic commit with an explicit access-policy precondition, avoiding missing-document transaction lock conflicts. Keep the cutoff fixed at the original approved release boundary across ordinary updates. If the browser Web API key has website-referrer restrictions, do not weaken them: approve a separate same-project Auth REST key suitable for server use, restricted to the necessary API, and configure that server binding instead.

## Existing-workspace inventory and counter provisioning

Run only through an authorized operator AFTER explicit approval. This tool is not a browser/admin dashboard endpoint. It uses a short-lived operator OAuth token via `GROWTHMARK_PROVISION_ACCESS_TOKEN`, with Firestore read/write permissions needed for the approved maintenance. No token or credential file is committed or printed. Do not run the emulator-only initializer against production or remove its guards.

Keep review documents in ignored `.release-private/` or outside the repository. A starting private review file has this shape, using the actual workspace Auth UID:

```json
{
  "version": 1,
  "projectId": "growthmark-c0e9c",
  "workspaceId": "ACTUAL_AUTH_UID",
  "reviewer": "ACTUAL_REVIEWER",
  "complete": false,
  "externalReferences": []
}
```

Read-only plan command (still a real production read, requiring authorized access):

```powershell
node scripts/admin/provision-workspace.mjs --uid ACTUAL_AUTH_UID --review .release-private/review.json
```

An authorized operator with an already approved Google Cloud CLI session can obtain the short-lived token without printing it by assigning `$env:GROWTHMARK_PROVISION_ACCESS_TOKEN = (gcloud auth print-access-token --project=growthmark-c0e9c)` in their private terminal. Do not run this during local validation, echo the token, put it in command arguments or store it in Git. Clear that environment variable after approved provisioning. If the CLI/session is unavailable, stop for authorized access rather than extracting cached credentials or inventing a token.

The plan extracts stored header numbers, snapshot reference fields, private request bindings and external references; includes archived/cancelled invoices and orphan checks; normalizes prefixes/leading zeros; detects duplicates, malformed/unknown history and counters below history; and returns a deterministic `inventoryDigest` and high-water baseline. It never treats a document-ID list alone as proof. Existing counters are not overwritten or automatically repaired.

Reconcile external PDFs, exports, reserved numbers and other historical sources with the owner. External references use `{ "id": "reviewed-record-id", "reference": "OLD-000047" }`; use the matching invoice ID for an external copy of the SAME invoice. Ambiguous reference formats or unrecognized stored schemas STOP provisioning for that workspace. Do not edit data or omit records to make the plan pass. Keep it pending and report the reason.

After independent review, add the exact current `inventoryDigest`, retain the correct project/workspace, set `complete: true`, and name the reviewer. Only after explicit write approval:

```powershell
node scripts/admin/provision-workspace.mjs --uid ACTUAL_AUTH_UID --review .release-private/review.json --apply --approved-production-write
```

This temporarily blocks owner writes through a trusted suspension override, re-inventories actual stored values and compares the reviewed digest, then atomically creates the counter (and missing structured prefix preferences) and restores the original access policy. The counter begins at the historical high-water mark, not necessarily zero; the NEXT invoice uses high-water + 1. Changing a prefix never resets it. It refuses a pre-existing counter. All trusted import/admin writers must also honor the maintenance window: privileged writers bypass rules.

Original suspension/policy metadata is preserved. A concurrent administrator policy change is never overwritten or reactivated. On a crash, review the temporary `provisioningLock` and original access policy before any manual unlock; do not blindly unsuspend an account. If the commit response is uncertain, read the actual counter and access policy before doing anything else. Never rerun with a fabricated baseline, reset a counter, or delete issued/history records. Publish nothing for an ambiguous workspace's numbering until reviewed.

## Rules publication — ONLY AFTER APPROVAL

Review and save a copy of the actual deployed rules first. The prepared file is `firestore.release.rules`; `firebase.release.json` targets only this file. Use the existing Firebase CLI/account, confirm the project in the Console, and then ONLY if approved:

```powershell
npx --no-install firebase deploy --only firestore:rules --project growthmark-c0e9c --config firebase.release.json
```

This publishes production rules and is NOT a local test. Do not run a bare `firebase deploy`, hosting deploy, index deploy or billing action. The existing `firestore.rules`, old proposals and emulator configs were preserved for history; they are NOT the release publication target. The final rules already include private payment-override reads, immutable allocation identity/request bindings, atomic counter/header/snapshot/item checks, legacy edits, account suspension and all module isolation. No public or unrestricted admin access is added.

## Local checks and exact Git commands — after final review/approval

These build flags affect only the current terminal and do not modify `.env.local` or contact Firebase:

```powershell
Set-Location 'C:\Users\user\Documents\GrowthMark-CRM'
$env:VITE_USE_FIREBASE_EMULATORS='false'
$env:VITE_INVOICE_CANDIDATE_PREVIEW='false'
$env:VITE_ENABLE_NUMBERED_INVOICES='true'
npm.cmd run build:cloudflare
node scripts/release-preflight.mjs
git status --short
```

The preflight writes the exact safe project file list to `docs/release-git-files.txt`, scans for private key material and checks private/generated ignores. Review that list and stop on unexpected files. Generated emulator/test exports, screenshots/PDF fixtures, backups, credentials and `.env.local` are not part of it.

Only AFTER commit/push approval, with the reviewed manifest:

```powershell
git add --pathspec-from-file=docs/release-git-files.txt
git diff --cached --name-only
git diff --cached --check
git commit -m "Prepare secure invoice workflow and workspace provisioning"
git push origin main
```

Do not force push. A push to `main` MAY immediately trigger the existing Cloudflare deployment, so it also requires deployment approval and correct prior production setup. Pause automatic deployments if code must be uploaded before publication approval. No Git command above was executed for staging, commit or push during preparation.

## Safest publication order

Agree maintenance/rollback artifacts and approve the complete rules/server credential setup first. Review current live configuration and data backups. Publish the approved protective rules during the maintenance window. Inventory and provision existing workspaces using reviewed digests; stop ambiguous ones individually. Configure the existing Pages project's browser variables, server secret and cutoff. Then approve commit/push/deployment, publish through the existing Git integration and verify Functions are present. Smoke-test with an explicitly approved real test account only AFTER release approval; no real account/data was created for local validation.

## Rollback

Keep the new protective rules, counters, allocation bindings, snapshots and saved overrides. Disable creation by setting `VITE_ENABLE_NUMBERED_INVOICES=false` and rebuilding this SAME read-compatible release through the guarded build, then publish only after approval. Existing invoice reads/edits and overrides remain compatible. You may disable `WORKSPACE_PROVISIONING_ENABLED` to stop new provisioning; this does not revoke existing workspaces.

The browser feature flag is a UI rollout control, not a database authorization switch: cached/direct clients remain constrained by the protective rules. If an enforceable emergency write stop is required, an authorized administrator can use the existing per-workspace suspension policy after explicit approval; that also blocks workspace reads. Do not weaken or reset rules/counters to simulate a rollback.

Do not roll rules back to the old baseline or read-only transitional proposal after protected invoices exist. Do not roll the frontend back to a build that ignores overrides or protected metadata. Cloudflare's old deployment rollback button is safe only for an independently verified compatible artifact. Never reset/decrease counters, change historical invoice numbers, delete allocation identities, or recreate users/workspaces as rollback. Investigate uncertain commits by their existing UID/invoice/request IDs instead of allocating replacement IDs.

For a suspected credential exposure, an administrator must disable/rotate the server binding and review access logs without weakening rules. For quota exhaustion, preserve read-safe behavior and disable provisioning/creation until the quota resets or another separately approved solution exists; do not enable billing automatically.
