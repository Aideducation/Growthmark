# GrowthMark invoice integration — Step 5 review

Date: 12 November 2026 (Asia/Calcutta). Local candidate implementation only; not a production-readiness claim.

| Validation | Result |
|---|---|
| Workflow tests | 12 passed, 0 failed |
| Compatibility tests | 18 passed, 0 failed |
| Combined final workflow/compatibility run | 30 passed, 0 failed |
| Extracted allocator and authenticated store | 31 passed, 0 failed |
| Service integration | 11 passed, 0 failed |
| Existing regression suite | 128 passed, 0 failed |
| Deployment guard | 4 passed, 0 failed |
| TypeScript | Passed |
| Production build | Passed; existing >500 kB chunk warning (main chunk about 968 kB) |

All test data writes were restricted to disposable demo test/preview projects. The regression runner name `--production-rules` selects an unchanged local rules file in an emulator; it never publishes rules. An initial negative-test fixture incorrectly selected UPI while disabling it in its override; the fixture was corrected, with validation left intact.

Browser verification is PARTIAL. Observed: candidate sign-in, invoice editor, Generate disabled during save, missing-counter error, zero invoices after that failed save, and pending request retained after refresh. After trusted initialization of the empty preview-only counter, the isolated database confirmed exactly one numbered invoice. Browser automation then became unavailable, so successful-reference display, remaining visual interactions, themes/responsive layouts, PDF download and end-to-end account switching have not received full browser sign-off. Server rendering, PDF generation, WhatsApp handler logic, Auth switching and owner-scoped recovery are covered by automated tests; these do not replace browser visual review.

Preview: http://127.0.0.1:5175/ — demo-growthmark-invoice-preview, Auth 9299, Firestore 8380. Existing development data on 9099/8080 was not touched. Preview test fixtures are clearly labelled and are not real business records.

Limits requiring review: normal users still cannot initialize counters; production provisioning is not implemented. The request marker remains editable owner-authored JSON under the unchanged rules, rather than a database-immutable audit record. Refresh preserves request IDs only, so an uncommitted draft may require re-entry. Legacy basic drafts must first save their original enhanced snapshot before adding an invoice-specific override. Issuance, public links and verified payments remain disabled.

No production Firebase settings/data, published rules, billing, commits, pushes or deployment were changed. `.env.local` was not edited. All four rule files retain their prior SHA-256 values. Existing rules: EDC4643D521B1FB93644750A66A9D0B1B3AFC7FB024514DF5A1E83C9E466D791. Workflow candidate: 1058440572DD6909F181F728BC101E94FCCAAFFD4625A467CD3257AFC6134DD5.

The working tree contains earlier uncommitted work. The following 28 files are the source/configuration/documentation files changed specifically in Step 5. Generated ignored build/test logs and artifacts were also refreshed.

| File | Change | Purpose |
|---|---|---|
| [src/services/invoice-preview-mode.ts](C:/Users/user/Documents/GrowthMark-CRM/src/services/invoice-preview-mode.ts) | Added | Strict development/emulator preview selection and isolated ports. |
| [src/services/firebase.ts](C:/Users/user/Documents/GrowthMark-CRM/src/services/firebase.ts) | Updated | Separate candidate app/project/ports; real Firebase branch retained. |
| [src/features/auth/auth-api.ts](C:/Users/user/Documents/GrowthMark-CRM/src/features/auth/auth-api.ts) | Updated | Recognize only the new loopback preview Auth emulator. |
| [src/features/workspace/record-service.ts](C:/Users/user/Documents/GrowthMark-CRM/src/features/workspace/record-service.ts) | Updated | Close generic new-invoice creation; existing edits retained. |
| [src/features/workspace/RecordPage.tsx](C:/Users/user/Documents/GrowthMark-CRM/src/features/workspace/RecordPage.tsx) | Updated | Prevent alternate invoice-create button; other modules unchanged. |
| [src/features/workspace/WorkspaceDataProvider.tsx](C:/Users/user/Documents/GrowthMark-CRM/src/features/workspace/WorkspaceDataProvider.tsx) | Updated | Expose pending-write state for invoice number confirmation. |
| [src/features/workspace/invoices/workflow.ts](C:/Users/user/Documents/GrowthMark-CRM/src/features/workspace/invoices/workflow.ts) | Added | Shared prefix, status, payment validation and presentation resolution. |
| [src/features/workspace/invoices/pending-request.ts](C:/Users/user/Documents/GrowthMark-CRM/src/features/workspace/invoices/pending-request.ts) | Added | Owner-scoped metadata-only pending request persistence. |
| [src/features/workspace/invoices/InvoicePaymentEditor.tsx](C:/Users/user/Documents/GrowthMark-CRM/src/features/workspace/invoices/InvoicePaymentEditor.tsx) | Added | Collapsed invoice-specific payment editor and original-snapshot reset. |
| [src/features/workspace/invoices/model.ts](C:/Users/user/Documents/GrowthMark-CRM/src/features/workspace/invoices/model.ts) | Updated | Remove shared GM default; validate selected methods against resolved instructions. Calculations unchanged. |
| [src/features/workspace/invoices/snapshot-codec.ts](C:/Users/user/Documents/GrowthMark-CRM/src/features/workspace/invoices/snapshot-codec.ts) | Updated | Decode overridden methods while keeping original snapshots and allocation metadata separate. |
| [src/features/workspace/invoices/service.ts](C:/Users/user/Documents/GrowthMark-CRM/src/features/workspace/invoices/service.ts) | Updated | Structured prefix writes, legacy defaults, status/override CAS saves, confirmed pending recovery. |
| [src/features/workspace/invoices/AgencySettings.tsx](C:/Users/user/Documents/GrowthMark-CRM/src/features/workspace/invoices/AgencySettings.tsx) | Updated | Structured prefix authority, business-name default, account-safe legacy autofill. |
| [src/features/workspace/invoices/InvoicePreview.tsx](C:/Users/user/Documents/GrowthMark-CRM/src/features/workspace/invoices/InvoicePreview.tsx) | Updated | Confirmed reference, manual label, shared resolved payment details. |
| [src/features/workspace/invoices/pdf.ts](C:/Users/user/Documents/GrowthMark-CRM/src/features/workspace/invoices/pdf.ts) | Updated | Same resolved payment details/reference as preview; DRAFT marking retained. |
| [src/features/workspace/invoices/InvoicePage.tsx](C:/Users/user/Documents/GrowthMark-CRM/src/features/workspace/invoices/InvoicePage.tsx) | Updated | Generate/update wiring, stable requests, pending recovery, statuses and private overrides. |
| [src/features/workspace/invoices/invoices.css](C:/Users/user/Documents/GrowthMark-CRM/src/features/workspace/invoices/invoices.css) | Updated | Small theme-aware styling for the collapsed payment editor. |
| [firebase.invoice-preview.json](C:/Users/user/Documents/GrowthMark-CRM/firebase.invoice-preview.json) | Added | Separate local preview configuration using unchanged candidate rules. |
| [scripts/run-invoice-preview.mjs](C:/Users/user/Documents/GrowthMark-CRM/scripts/run-invoice-preview.mjs) | Added | Credential-free demo-emulator preview launcher with no import/export/reset. |
| [scripts/build-vercel.mjs](C:/Users/user/Documents/GrowthMark-CRM/scripts/build-vercel.mjs) | Updated | Reject local invoice-preview flag in deployment builds. |
| [tests/security/helpers/invoice-compatibility.mjs](C:/Users/user/Documents/GrowthMark-CRM/tests/security/helpers/invoice-compatibility.mjs) | Updated | Pass confirmed reference into the actual WhatsApp handler test adapter. |
| [tests/security/module-services.test.mjs](C:/Users/user/Documents/GrowthMark-CRM/tests/security/module-services.test.mjs) | Updated | Historical basic-invoice fixture replaces the retired generic creation setup. |
| [tests/security/invoice-service-integration.test.mjs](C:/Users/user/Documents/GrowthMark-CRM/tests/security/invoice-service-integration.test.mjs) | Updated | Assert service-level rejection of the closed generic creation path. |
| [tests/security/invoice-ui-workflow.test.mjs](C:/Users/user/Documents/GrowthMark-CRM/tests/security/invoice-ui-workflow.test.mjs) | Added | Twelve workflow, prefix, status, override, recovery and isolation checks. |
| [tests/security/run-invoice-ui-workflow.mjs](C:/Users/user/Documents/GrowthMark-CRM/tests/security/run-invoice-ui-workflow.mjs) | Added | Combined workflow/compatibility runner using isolated candidate emulators. |
| [tests/security/deployment-build.test.mjs](C:/Users/user/Documents/GrowthMark-CRM/tests/security/deployment-build.test.mjs) | Updated | Verify deployment rejects the candidate-only flag. |
| [docs/invoice-candidate-preview.md](C:/Users/user/Documents/GrowthMark-CRM/docs/invoice-candidate-preview.md) | Added | Local-only preview startup, safety boundaries and recovery behaviour. |
| [docs/step5-validation.md](C:/Users/user/Documents/GrowthMark-CRM/docs/step5-validation.md) | Added | This validation report and complete Step 5 changed-file manifest. |
