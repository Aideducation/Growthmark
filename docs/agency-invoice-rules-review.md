# Agency/invoice rules audit — proposal only

The Settings warning is emitted by a catch-all handler for any `loadAgency` failure, not only permission-denied. Inspection and emulator reproduction confirm that the original project rules deny the new agency and invoice snapshot paths. No authenticated live Console/rules inspection was performed; this report does not assert the currently deployed rules are identical to the local file.

## Exact affected operations

- `get workspaces/{uid}/settings/agency`: denied because existing settings reads whitelist only business/payment/invoice. This is the initial load that can trigger the warning.
- `create/update workspaces/{uid}/settings/agency`: denied because no validator/allow branch exists for agency. `saveAgency` first reads the same denied document during its transaction.
- `get/create/update workspaces/{uid}/invoices/{id}/configuration/snapshot`: denied by the catch-all rule. `saveAdvancedDraft` reads this path before attempting its atomic writes.
- `create workspaces/{uid}/invoices/{id}/items/{itemId}` together with a new invoice header: denied because the original item rule requires the header to exist in draft state before the transaction, not just afterward.
- Existing basic invoice header writes, and item CRUD under an already-existing editable draft, are not universally denied. Advanced saving fails because its combined operation includes denied paths. Failed transactions do not partially commit the header.

## Proposed minimum additions

Review `../firestore.agency-invoice.proposed.rules` and the exact `agency-invoice-rules.diff` beside this document.

1. Owner-only get/create/update for the single `settings/agency` document, retaining the exact metadata envelope and allowing only bounded profileJson (150,000 characters). No collection listing or deletion.
2. Owner-only get/create/update for the single `invoices/{id}/configuration/snapshot` document. Exact envelope plus agencyJson/clientJson/contentJson bounded to 150,000/10,000/220,000 characters. Agency/client snapshots freeze on first save. No listing or deletion.
3. Permit invoice item creation alongside a new draft header, only when the after-transaction header is a valid draft. Existing header schema, client ownership, item shape/ranges and metadata validators remain mandatory. Quotations retain their original parent requirement.
4. Once an enhanced snapshot exists, header/item edits require its revision to advance atomically. Snapshot writes likewise require a new draft header or a revision increment to an existing draft header. This prevents independent legacy-editor writes from bypassing the saved snapshot workflow.

Verified identity, active account, workspace ID equal to Auth UID, immutable owner/creation/schema, server timestamps, revision checks, existing module validators and deny-all unknown paths remain. No public/admin/counter/issued-invoice/invoice-payment access is added. Unverified users remain denied; merely being signed in is insufficient.

JSON fields are bounded private draft content. Firestore Rules cannot parse their detailed JSON schema or verify invoice calculations. Application validation and integer draft estimates remain in place; a future issuance service must independently validate/recompute financial values. This proposal does not enable official issuance or payment verification.

## Executed tests

`npm.cmd run test:security -- --agency-invoice` — **127 tests passed, 0 failed**, exit 0. Includes all original module/auth/security tests against the proposal, calculation/PDF tests and nine agency/invoice tests. Test project only: demo-growthmark-security-tests, Auth 9199 / Firestore 8180.

New coverage explicitly reproduces original-rule denials, proves rollback of denied atomic creation, rejects independent header/item/snapshot updates, rejects active foreign-owner/anonymous/unverified operations and rejects snapshot replacement or privilege/ownership/creation-time injection even inside atomic batches. Existing profile saves, snapshot preservation, concurrency/revision rejection, suspended-account restrictions and unknown-path protections remain covered.

Only the proposal, its security test file, this review and the diff were changed during this audit. No application files, original rules, Firebase settings, live data, billing or deployment were changed. The warning will remain until the appropriate environment receives reviewed/approved rules; no such change was made here.
