# Local invoice candidate preview — Step 5

This workflow is a local candidate, not a production release. Production rules and `.env.local` are unchanged.

The preview uses **demo-growthmark-invoice-preview**, Authentication **127.0.0.1:9299**, and Firestore **127.0.0.1:8380**. It is separate from existing development data (9099/8080) and disposable automated tests (9199/8180).

Start its emulators in one PowerShell terminal:

```powershell
node scripts/run-invoice-preview.mjs
```

Start Vite in a second terminal, using process-only settings:

```powershell
$env:VITE_USE_FIREBASE_EMULATORS = 'true'
$env:VITE_INVOICE_CANDIDATE_PREVIEW = 'true'
npm.cmd run dev -- --host 127.0.0.1 --port 5175 --strictPort
```

Open http://127.0.0.1:5175/. The production build guard rejects the candidate flag. Do not use this mode with production Firebase.

New users do not initialize their own counters. A missing counter blocks Generate Invoice without creating an unnumbered invoice. Trusted initialization remains an administrative/test operation, outside frontend code. No production counter initialization is included.

Generate Invoice saves a numbered **private draft**, not an officially issued invoice. The structured `settings/invoice.invoicePrefix` is authoritative. Changing the prefix never resets a counter or changes an existing reference.

All six manual statuses are owner labels. Paid does not verify a payment or increase collected revenue. Invoice payment overrides are private instructions; reset copies from that invoice's original snapshot, never the latest profile.

Only owner/invoice/request IDs and a submitted flag are kept in tab session storage for recovery. Invoice contents, banking data and credentials are not stored there. A failed or uncertain save retains its IDs. Check pending save before starting another invoice. Refresh may require re-entering an uncommitted draft; it never generates replacement IDs automatically for that pending submission.

The recovery marker remains service-protected JSON, not a database-immutable audit record. No issuance, public payment links, gateway verification, billing or deployment is enabled.

Automated validation commands (each uses isolated demo emulators):

```powershell
node tests/security/run-invoice-ui-workflow.mjs
node tests/security/run-invoice-service-integration.mjs
node tests/security/run-extracted-allocation.mjs
node tests/security/run-invoice-compatibility.mjs
npm.cmd run test:security -- --production-rules
```

The last command's name refers to a local rules file; it never publishes production rules. Historical regression fixtures are explicitly test-only and do not use an unnumbered application creation path.
