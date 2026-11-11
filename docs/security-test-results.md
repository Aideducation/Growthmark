# Stage 1 local security test results

This is the original 82-test preparation report. The subsequent Phase 2 run executed 96 passing tests, including these 82; see [phase2-authentication.md](phase2-authentication.md) for the current implementation, additional results and limitations. The local runner replaces `latest.txt` on each execution.

Executed on 10 November 2026 with `npm run test:security`.

- Project: `demo-growthmark-security` (no live resources).
- Auth emulator: `127.0.0.1:9099`.
- Firestore emulator: `127.0.0.1:8080`, official emulator v1.22.0, Standard edition.
- Firebase CLI: 15.35.0; official Rules testing library: 6.0.0.
- Java: project-local Eclipse Temurin 21 runtime, download checksum verified.
- Node: 26.13.0.
- Executed tests: **82**.
- Passed: **82**. Failed: **0**. Skipped/cancelled: **0**.
- Test-runner duration: approximately 23.3 seconds, excluding emulator startup/download.
- Emulator script exit code: **0**. Emulators shut down after completion.

Actual output is saved locally in ignored `tests/security/results/latest.txt`; rerunning replaces that output. The rules were loaded by the official Firestore emulator and both permitted and denied operations were executed. No claim of compilation or test success is based only on inspecting source.

## Covered behavior

- Real emulator email/password registration, local email verification, logout/login and verified simulated Google-provider sign-in.
- Mutual profile/workspace provisioning: standalone profile/workspace creation rejected, atomic bootstrap accepted.
- Freelancer A and B: independent profiles/workspaces; owner access accepted; foreign reads, queries, creates, edits and deletes rejected across all Stage 1 record modules.
- Business, private banking and invoice settings isolation.
- Clients, project/client references, tasks, draft quotation/invoice editing and item CRUD.
- Ownership/metadata immutability, exact field lists, required fields, type/length/range validation and revisions.
- Denied issued numbers, financial totals, snapshots, verified/paid fields and gateway provenance.
- Draft archiving locks parent/items; archive-plus-item-change in one commit rejected.
- Owner-recorded payments accepted; modification/replacement/deletion rejected; invalid amounts/currency/dates/references rejected.
- Concurrent transaction submissions with one payment ID produce exactly one entry.
- Anonymous, unverified, missing-verification, unsupported-provider, suspended and malformed-access identities rejected.
- Suspension affects an existing client context, and owners cannot remove it.
- Public links, admin records, financial controls and unknown paths denied; simulated super-admin claims grant no additional Stage 1 permissions.
- Cross-workspace collection-group queries and settings enumeration rejected.

## Corrections during preparation

- Allowed an owner to read their own absent workspace path so signup transactions can inspect absence safely.
- Added mutual `getAfter()` provisioning checks so profile and workspace cannot be created separately.
- Checked draft parent state before and after item writes/deletes to block atomic archive bypasses.
- Enforced integer schema/revision values and project/draft date ordering.
- First execution attempt started the emulators but ran no tests because a Windows PATH-case issue hid Node from the subprocess. Corrected PATH preservation; the subsequent run above executed all tests successfully.

## Remaining scope and limitations

- No live rules were read, changed or published; no live Auth accounts or Firestore records were created. Billing and deployment were not enabled.
- The dashboard and its Firebase SDK initialization are unchanged. No application login/CRUD UI is implemented by this test suite.
- Google testing uses an emulator-supported unsigned credential, not the real Google OAuth UI.
- The suite does not cover Storage Rules, live quotas, production indexes, tax/accounting calculations, real bank transfers, production abuse protection or Stage 2 backend behavior.
- Manual payments are owner assertions, not independently verified. Duplicate real payments submitted under different document IDs are not prevented by this schema.
- Old frontend design contracts are not serializers for the new Firestore schema; future adapters must map them explicitly.
- npm reported deprecations and an engine warning for the CLI's transitive Hosting dependency `superstatic` on Node 26. The Auth/Firestore test run succeeded; Hosting was neither started nor deployed. A supported Node 24 toolchain is preferable for longer-term CLI/CI standardization.
