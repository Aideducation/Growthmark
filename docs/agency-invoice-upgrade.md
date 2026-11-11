# Agency Profile and advanced invoice drafts

## Status and security boundary

Implemented in Settings → Agency Profile and Invoices. This is a draft enhancement, not a complete issued-invoice accounting system. No providers, authentication code, Firebase configuration, billing, deployed rules or existing business data were changed. The original `firestore.rules` remains untouched.

**Advanced persistence is not activated in the normal app yet.** Its new paths require the separately prepared `firestore.agency-invoice.proposed.rules`. Those rules have been loaded only in isolated test emulators. Current deployed/development rules may reject these reads and saves; the UI reports that limitation. Do not publish or load the proposal into an existing environment without review and approval. The new unsaved invoice preview can use existing business settings when agency storage is unavailable.

## Implemented

- Independent agency identity, owner/contact/address/PAN/GSTIN, GST preferences, payment-method configuration, branding/default terms, prefix, preferred currency and signature settings.
- PNG/JPEG upload → browser raster decode → PNG re-encoding, maximum 512 pixels and 45,000 data-URL characters per image. PNG data stays in private Firestore documents; no external image requests or Storage dependency. Logos, QR images and signatures have previews. Actual uploaded QR codes must still be scanned and verified by the owner.
- Invoice search, client/status/date/amount filters and CSV; existing basic-draft tools remain accessible. Enhanced drafts are excluded from basic tools to avoid losing snapshots.
- Existing client selection, invoice-specific client billing/GSTIN/contact fields and new-client creation through the unchanged client service.
- Service suggestions, up to 50 editable/reorderable items, units/quantity/rates, fixed/percentage item and overall discounts, inclusive/exclusive GST and split CGST/SGST or IGST. New invoices and new lines always start at 0% GST. The preferred agency GST rate is applied only by an explicit button.
- BigInt calculations: quantity uses thousandths, money minor units, percentage rates basis points. Round half up, allocate overall discount proportionally before tax, give the final nonzero line the allocation remainder. Inclusive prices extract GST after discount. Additional charges are explicitly non-taxable. Split GST gives an odd minor unit to SGST. This is a documented draft estimation policy; owners remain responsible for tax eligibility/place of supply.
- A4 preview, embedded-font client-side PDF with raster images and multiple pages, download and PDF-viewer printing. All documents are marked DRAFT / NOT ISSUED.
- Editable WhatsApp message that opens `wa.me`; uses saved client WhatsApp when present. Does not attach files, send messages automatically, expose a public link or present a draft as a payment demand.
- Agency/client snapshots freeze when the advanced draft is first saved. Later profile/client changes do not replace them. Existing basic drafts acquire snapshots only when explicitly saved through the advanced editor; there is no bulk migration.
- Atomic Firestore saves of header, snapshot and existing-schema estimate items, optimistic revision checks and a stable new-draft request ID to prevent accidental duplicate retry creation. Existing readers of invoice items continue to sum the exact draft total, without changing Dashboard or Reports code.

## Data paths and proposal

- `workspaces/{uid}/settings/agency`: existing metadata envelope + bounded `profileJson` (150,000 characters). Supplements the existing business/payment/invoice settings without changing their behaviour. The new Agency Profile is the invoice-specific settings source; old Business Profile fields are not automatically synchronized.
- `workspaces/{uid}/invoices/{id}`: unchanged draft header schema.
- `workspaces/{uid}/invoices/{id}/configuration/snapshot`: metadata + `agencyJson`, `clientJson`, `contentJson` (150,000 / 10,000 / 220,000 character limits). Agency/client JSON is immutable after creation. Draft content holds detailed line/calculation inputs; totals are recalculated on read/export, not trusted as authoritative financial claims.
- `workspaces/{uid}/invoices/{id}/items/{itemId}`: existing schema, with `advanced-` identifiers. Each contribution contains the calculated post-discount/tax estimate amount at quantity one; an additional item represents non-taxable charges. Detailed original quantities, rates and taxes are in the snapshot. These remain untrusted draft estimates.

The proposal retains verified-owner/active-account checks, immutable ownership/schema/creation timestamps, server update timestamps, revision increments, exact document envelopes and deny-all unknown paths. Snapshots remain private. Changes to enhanced header/items require a snapshot revision increment in the same atomic operation, preventing legacy editor writes. It allows same-transaction creation of an invoice draft header and items. It does not grant public reads, admin claims, counters, invoice issuance or invoice-linked payments.

JSON content is bounded private owner-authored draft data. Firestore Rules cannot parse JSON or establish authoritative totals. The application validates the detailed schema and computes estimates, but a future trusted issuance operation must independently parse, validate and recalculate everything. The proposal intentionally cannot make owner-authored drafts into issued financial records.

## Still disabled or limited

- Official sequential invoice numbers, secure concurrent issuance, sent/paid/partial/overdue/cancelled states and issued-invoice financial summaries. The prefix is stored but no official number is generated or consumed.
- Invoice-linked manual payments, overpayment prevention, reversals and settlement. The existing Payments module has no compatible invoice linkage/transaction controls, so its behaviour is unchanged. Full/partial invoice payment tracking remains pending.
- Public invoice/payment links, verified payments and gateways.
- Advanced archive/cancellation transitions; existing basic draft archive tools remain available. Issued-record editing is not introduced.
- Invoices use workspace currency to preserve existing cross-module reports. A preferred currency is configurable, but changing workspace currency/multi-currency accounting is outside this scope.
- No live Firebase settings or current Storage bucket provisioning were inspected through authenticated Console access. Firebase's published Storage requirements call for Blaze; this implementation uses no Storage operations or paid services.

## Validation actually performed

`npm.cmd run build`: TypeScript + production build passed. Existing >500 KB bundle warning remains.

`npm.cmd run test:security -- --agency-invoice`: **123 passed, 0 failed**, including the original 110 tests run against the proposal, 8 calculation/PDF tests and 5 new agency/invoice integration/security tests. Tests run only in the isolated `demo-growthmark-security-tests` project on ports 9199/8180. Development accounts and workspaces are not cleared. Without the extra flag, the original test command continues to use original rules.

Coverage includes profile create/edit, cross-owner and anonymous/unverified/suspended rejection, owner/extra-field/oversize rejection, atomic invoice save, duplicate request rejection, revision conflicts, frozen snapshots after profile edits, canonical item totals, private snapshots and denied issuance/counters/public links/invoice payments. PDF tests exercise PNG logo/QR/signature embedding and multipage output. They do not establish actual QR scannability.

Browser inspection used `tests/visual/invoice-preview.html`, an explicitly labelled standalone fixture with no Firebase imports or saved records: desktop A4 layout, 390 px mobile internal scrolling/no page overflow, dark-mode contrast and no console errors. The preview intentionally keeps white paper in both themes. The generated 16-page stress-test PDF was rendered with PDFium; first/last pages inspected, A4 dimensions verified, text present on all pages.

Not tested end-to-end: physical printing, delivery through WhatsApp, real Google sign-in, live Firestore saves, complete interactive agency/image-upload/invoice-editor flows in an authenticated browser. Service-level saves were tested in emulators. No real clients/invoices/payment records were seeded.

## Files

Existing app integration only: `src/features/workspace/SettingsPages.tsx` (mount Agency Profile) and `WorkspacePages.tsx` (route Invoices to the enhanced page). No sidebar or other routes changed.

New feature files: `src/features/workspace/invoices/{AgencySettings,InvoicePage,InvoicePreview}.tsx`, `model.ts`, `service.ts`, `images.ts`, `pdf.ts`, `invoices.css`.

Proposal/testing: `firestore.agency-invoice.proposed.rules`, `scripts/run-security-tests.mjs` (opt-in proposal flag), `tests/security/helpers.mjs` (allowlisted test-only rule selection), `tests/security/advanced-invoice-calculations.test.mjs`, `tests/security/agency-invoice-security.test.mjs`, `tests/visual/invoice-preview.html`, `tests/visual/invoice-preview.tsx`, and this report. Generated ignored test results/PDFs and the local `dist` build are validation output.

No Dashboard, Clients, Projects, Tasks, Quotations, Payments, Retainers, Reports, authentication, onboarding, navigation or global-theme implementation was modified. Existing unrelated Settings sections are retained. No dependency was installed. This uses existing free client-side libraries and Spark-compatible Firestore operations, subject to Spark quotas; it does not guarantee unlimited free usage.
