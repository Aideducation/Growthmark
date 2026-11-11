# Stage 1 local security tests

Run `npm run test:security`. It starts only the Authentication and Firestore emulators, runs Node's test runner and stops the emulators. Logs are saved to ignored `tests/security/results/latest.txt`.

The suite imports the actual application auth/workspace/module services and tests PDF/CSV output. Node 24+ is required for native TypeScript execution (the executed environment uses Node 26). The latest combined run executed 110 passing tests. Tests now use isolated ports and a distinct demo project; development emulators can remain running without their data being cleared. See `docs/module-status.md`.

Safety boundaries:
- Fixed test project: `demo-growthmark-security-tests`, not the live project or the development demo project.
- Both emulators bind only to `127.0.0.1`.
- Tests refuse to run without the exact local emulator host variables and demo project ID.
- The test suite never imports the app Firebase module or `.env.local`.
- No default Firebase configuration, real project alias, hosting configuration or deployment script is added.
- `firebase.tests.json` explicitly selects test ports Auth 9199 / Firestore 8180. `firebase.emulator.json` is used only by development (`npm run emulators`) on 9099 / 8080. Neither publishes rules.
- Suspensions and restricted-path fixtures are seeded using disabled rules only inside the guarded demo emulator.
- Auth integration tests create disposable local accounts, apply local verification codes and test actual emulator ID tokens. Mocked claims in rules-unit tests are used only for adversarial cases.

Java 21+ is needed by the official Firestore emulator. The runner prefers a portable Windows runtime under `.tools/java21/<runtime>/bin/java.exe` if available, otherwise it uses the system Java. `.tools` and emulator binaries under `.cache` are ignored. Emulator binaries may need downloading on the first run. No Java system installation is required by the local runner.

The rules implement the approved Spark-first schema, not the earlier backend-only write proposal. Fields required by the rules are represented in `helpers.mjs`; timestamp values are native Firestore timestamps and creation/update writes use `serverTimestamp()`. Workspace and profile provisioning must commit together, with IDs fixed to the Auth UID. The application UI and older TypeScript design contracts are intentionally not adapted in this preparation phase.

Coverage includes two-way tenant isolation; profile/workspace provisioning; password and emulated Google Auth; clients/projects/tasks; settings; draft documents and line items; immutable manual payments; retry idempotency for one submission ID; protected metadata; forbidden financial/admin fields; anonymous/unverified/suspended identities; public/admin/internal/unknown paths; and atomic draft-archive bypass attempts.

Limits: emulated Google credentials do not exercise Google's real OAuth consent UI. Rule tests do not validate tax calculations, actual bank transfers, Storage Rules, production indexes, project quotas, rate limits or production service availability. Manual payment entries remain owner assertions, not independent verification. Different submission IDs can still represent the same real payment. No Stage 2 issuance/public links/admin operations are implemented or permitted by these rules.

The live deny-all rules must remain in place until separate review and authorization. Passing this suite is evidence for the tested cases, not proof of universal security.
