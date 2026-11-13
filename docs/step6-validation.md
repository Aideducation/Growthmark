# Step 6 validation — local database-level allocation security

Date: 12 November 2026 (Asia/Calcutta). Review candidate only. No deploy, commit, push, production rule publication, production provisioning, credentials use or live data/settings changes occurred. Existing development/preview emulator data was not used or reset. Test fixtures were restricted to disposable demo-growthmark-security-tests, Auth 9199 / Firestore 8180.

## Final executed results

| Validation | Result |
|---|---|
| Direct allocation-security tests | 17 passed, 0 failed |
| Shared allocator/recovery tests + real Auth/store tests | 31 passed, 0 failed |
| Invoice service integration | 11 passed, 0 failed |
| Snapshot compatibility | 18 passed, 0 failed |
| UI workflow/presentation/service tests | 16 passed, 0 failed |
| Combined hardened candidate suite | **93 passed, 0 failed, 0 skipped; exit 0** |
| Full regression suite against unchanged local baseline rules | **123 passed, 5 failed, 0 skipped; exit 1** |
| Same 128 regression assertions against separate read-compatible baseline proposal | **128 passed, 0 failed** |
| Additional read-only compatibility/isolation tests | **2 passed, 0 failed** |
| Combined read-compatible regression run | **130 passed, 0 failed, 0 skipped; exit 0** |
| Deployment guards | **4 passed, 0 failed; exit 0** |
| TypeScript | Passed independently and within final build |
| Final production build | Passed; existing >500 kB main-chunk warning, about 969.86 kB |
| Tracked-file whitespace check | Passed; Git emitted existing CRLF normalization notices |

Commands actually executed:

```text
node tests/security/run-step6.mjs
npm.cmd run test:security -- --production-rules
node tests/security/run-read-compatibility-regression.mjs
node node_modules/typescript/bin/tsc -b --pretty false
npm.cmd run build
node --test tests/security/deployment-build.test.mjs
git diff --check
```

The `--production-rules` name selects a local rules file in an emulator; it does not publish anything. The complete final candidate run included two independent-client concurrency cases: the shared allocator case uses a barrier proving equal initial counter reads, and the service case awaits all operations. Both allocated unique consecutive numbers. These also passed in earlier clean runs during this implementation; this is not a load/throughput guarantee. Stable request IDs, stale-read recovery, unchanged-counter denial, suspension/reference denial, bounded exhaustion, matching uncertain commit recognition and conflicting identity rejection all passed.

Final logs: tests/security/results/step6.txt (93), tests/security/results/latest.txt (baseline 123/5), tests/security/results/read-compatibility-regression.txt (130). These generated fixture logs remain ignored, not Git-upload artifacts. Final build and deployment guard output was captured in the execution session.

## Baseline failures and why they must not be hidden

The old baseline denies all access to `configuration/paymentOverride`, including GET when that document is absent. Always reading saved overrides is necessary to avoid silently displaying original payment details when creation is disabled or during a rollback.

Under that unchanged ruleset, three agency/invoice tests therefore received `permission-denied` (`false for 'get' @ L230`) while loading/editing snapshots. Two subsequent revision checks expected revision two but observed one because the preceding edit never occurred. The failures were at tests/security/agency-invoice-security.test.mjs tests beginning on lines 41, 42, 45, 61 and 72 at the time of execution. They demonstrate a real rollout incompatibility, not permissions that were weakened to make a test pass.

A separate `firestore.invoice-read-compatibility.proposed.rules` adds exactly verified-active-owner GET for that private path to the unchanged baseline. It permits no override writes, listing, deletion or public access. All 128 regression assertions plus two owner/foreign/anonymous/unverified/suspended/unknown-path tests then passed. The baseline production files were not edited. After protected allocation is enabled, retain the full hardened rules; do not use this transitional baseline as a rules rollback target.

Earlier iterations also exposed an obsolete test assumption (editable JSON marker was formerly recovery authority) and fixture setup that batched a project with a not-yet-existing client. The recovery test now corrupts the protected identity, and fixture dependencies are seeded in order. Existing authorization conditions were retained. Counter-mutation/invalid-item denial fixtures now capture otherwise-valid actual application writes before changing the intended restricted field.

## Verified scope and remaining limitations

- Structured immutable allocation on the header plus a create-only private request binding; normal owners cannot change/remove it or reuse the request for another invoice.
- Required original snapshot, ordered unique canonical item manifest and complete revision-linked item chain. Missing first/middle/last/all items, missing snapshot/binding/counter/header, duplicate sequence and unlisted/oversized items are denied atomically, with no partial business or binding records.
- Recovery ignores editable JSON marker identity for protected records. Service recovery and ordinary editing were tested after missing, null and forged marker changes. JSON-only legacy candidate snapshots remain editable but cannot masquerade as protected recoverable allocations.
- Saved overrides remain readable/editable with the former creation-related read flag false. Original snapshots and Agency Settings stay unchanged. Denied override reads fail closed. A frontend older than these compatibility changes is not an approved rollback binary.
- Protected creation is capped at **eight canonical item records including charges** to remain within rule access limits. Legacy fifty-line invoices plus charges still load/edit under the hardened rules and read-compatible regression proposal. Raising the protected limit needs a different reviewed storage/backend design.
- Snapshot payload is bounded to 900,000 UTF-8 bytes before writes. Oversized multi-byte payloads fail before transaction entry; the final encoded marker is checked again before allocation writes.
- Canonical record completeness is enforced; rules still cannot prove that editable JSON totals equal canonical financial amounts. Drafts are private estimates, not immutable issued invoices. Paid is a manual label only. No public links, verified payments or issuance were enabled.
- Production rules were not fetched or changed. Actual live-rule verification, counter inventory/provisioning, production feature enablement and browser visual sign-off remain pending. No production-readiness claim is made.

The production rollout/counter provisioning design, rule-access analysis and rollback order are in docs/step6-allocation-security.md. Provisioning was designed, not implemented or executed. The existing emulator initializer still refuses production and is unchanged.

## Rule integrity

The following three pre-existing files retain SHA-256 `EDC4643D521B1FB93644750A66A9D0B1B3AFC7FB024514DF5A1E83C9E466D791`:

- firestore.rules
- firestore.agency-invoice.proposed.rules
- firestore.production.proposed.rules

Final hardened candidate SHA-256: `9EA5B7A1CAC2736118AE44F55058B0B452674D6FE0825782437F5E530FDF43C1`.

Read-only compatibility proposal SHA-256: `AD20C0C76FFE7C911BFC63FEBA805C1C7ACAE85E9F4B78ECA50F1D7EBAB66E90`.

## Complete Step 6 source/documentation manifest (19 files)

The workspace already contained earlier uncommitted work. Only the files below were added/changed during Step 6. Generated ignored build output and emulator/test logs were also refreshed. No package, environment, Firebase configuration, authentication provider or unrelated module file was changed.

| File | Step 6 change |
|---|---|
| [firestore.invoice-workflow.candidate.rules](C:/Users/user/Documents/GrowthMark-CRM/firestore.invoice-workflow.candidate.rules) | Updated: immutable identity, create-only request binding, atomic header/counter/snapshot/item-chain checks. |
| [firestore.invoice-read-compatibility.proposed.rules](C:/Users/user/Documents/GrowthMark-CRM/firestore.invoice-read-compatibility.proposed.rules) | Added: separate transitional private owner-GET-only proposal. |
| [allocation-identity.ts](C:/Users/user/Documents/GrowthMark-CRM/src/features/workspace/invoices/allocation-identity.ts) | Added: strict protected identity type/validator and eight-item limit. |
| [allocation.ts](C:/Users/user/Documents/GrowthMark-CRM/src/features/workspace/invoices/allocation.ts) | Updated: protected identity/binding/manifest writes, bounded byte size, protected recovery. |
| [snapshot-codec.ts](C:/Users/user/Documents/GrowthMark-CRM/src/features/workspace/invoices/snapshot-codec.ts) | Updated: protected identity takes precedence over compatibility JSON marker; UTF-8 size validation. |
| [service.ts](C:/Users/user/Documents/GrowthMark-CRM/src/features/workspace/invoices/service.ts) | Updated: protected recovery/edits, coordinated item revisions, unconditional saved override reads and byte/count validation. |
| [InvoicePage.tsx](C:/Users/user/Documents/GrowthMark-CRM/src/features/workspace/invoices/InvoicePage.tsx) | Updated: three loader calls no longer tie payment reads to creation mode; no design changes. |
| [helpers.mjs](C:/Users/user/Documents/GrowthMark-CRM/tests/security/helpers.mjs) | Updated: allowlisted local read-compatibility proposal for tests. |
| [agency-invoice-security.test.mjs](C:/Users/user/Documents/GrowthMark-CRM/tests/security/agency-invoice-security.test.mjs) | Updated: allowlisted read-compatible rules selection; all regression assertions retained. |
| [invoice-workflow-candidate.test.mjs](C:/Users/user/Documents/GrowthMark-CRM/tests/security/invoice-workflow-candidate.test.mjs) | Updated: current TypeScript allocator/schema, eight-item boundary, protected identity recovery and valid coordinated denial fixtures. |
| [invoice-service-integration.test.mjs](C:/Users/user/Documents/GrowthMark-CRM/tests/security/invoice-service-integration.test.mjs) | Updated: new protected maximum seven services plus charges; old larger legacy coverage retained separately. |
| [invoice-ui-workflow.test.mjs](C:/Users/user/Documents/GrowthMark-CRM/tests/security/invoice-ui-workflow.test.mjs) | Updated: four rollback/marker/large-legacy compatibility cases. |
| [invoice-allocation-security.test.mjs](C:/Users/user/Documents/GrowthMark-CRM/tests/security/invoice-allocation-security.test.mjs) | Added: seventeen direct database, completeness, identity, isolation and bounds tests. |
| [invoice-read-compatibility.test.mjs](C:/Users/user/Documents/GrowthMark-CRM/tests/security/invoice-read-compatibility.test.mjs) | Added: two private GET/denial tests. |
| [planned-allocation.mjs](C:/Users/user/Documents/GrowthMark-CRM/tests/security/helpers/planned-allocation.mjs) | Added: test-only capture/commit adapter for otherwise-valid direct SDK denial fixtures. |
| [run-step6.mjs](C:/Users/user/Documents/GrowthMark-CRM/tests/security/run-step6.mjs) | Added: complete isolated hardened-candidate suite runner. |
| [run-read-compatibility-regression.mjs](C:/Users/user/Documents/GrowthMark-CRM/tests/security/run-read-compatibility-regression.mjs) | Added: full regression plus read-only compatibility tests in isolated emulators. |
| [step6-allocation-security.md](C:/Users/user/Documents/GrowthMark-CRM/docs/step6-allocation-security.md) | Added: schema/security rationale, limits and production provisioning/rollout design only. |
| [step6-validation.md](C:/Users/user/Documents/GrowthMark-CRM/docs/step6-validation.md) | Added: exact results, failures, limitations, hashes and this manifest. |

Stop point: Step 6 local implementation and validation only. Nothing is staged, committed, pushed, deployed or published by this work.
