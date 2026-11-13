# GrowthMark consolidated local release validation

Status: local release candidate completed; production publication remains pending explicit approval and production-only setup. This is not confirmation that currently deployed rules, IAM, Functions secrets, authorized domains or production counters are configured.

## Implemented

- Production invoice enablement via `VITE_ENABLE_NUMBERED_INVOICES`, independent of local preview mode. Disabled creation retains compatible reads/edits and saved payment overrides.
- Existing protected allocator, request identity, atomic counter/header/snapshot/item records, three-attempt recovery, frozen agency/client snapshots, manual status labels and legacy compatibility preserved.
- UI pre-validation for the eight-item total (charges consume one item), with disabled save/add controls and a clear explanation. Larger legacy invoices remain editable.
- Final full `firestore.release.rules` and an explicit rules-only `firebase.release.json` publication target. Rules retain the hardened candidate protections, including private override GET, with no public or unrestricted administrator access.
- Server-only Cloudflare Pages Function at `/api/workspace`. Google Auth REST validates the actual caller token; only verified active identity is accepted. No UID/admin/counter values are accepted from the browser. No Admin SDK or credential file is imported into the frontend.
- Safe new-account provisioning: fixed release cutoff, orphan-history checks, create-only atomic profile/workspace/counter/default-settings commit, access-policy precondition, stable UID and bounded contention recovery. Existing workspaces without counters are never assigned a guessed zero.
- Operator-only production-capable inventory/provisioning code, NOT executed against production. Plans read actual historical headers/snapshots/bindings/external references, fingerprint them, stop ambiguous/duplicate/unknown histories and refuse existing counter overwrites. Apply mode additionally requires explicit approval flags, reviewed digest and a CAS-protected maintenance freeze that preserves suspension/admin changes.
- Guarded Cloudflare builds, production project verification, direct Vite-build guards, Node 24 deployment pin, Functions-only `/api/*` routes, basic security headers and private artifact ignores.
- Local development/isolated-preview emulator configurations now select the final release rules on their next start, resolving the old payment-override GET mismatch locally too. No normal development emulator was restarted, reset or written during validation. Historical test configurations/rule files remain available separately.
- Fixed two real visual defects found in expanded browser review: tablet native upload controls overflowing Agency Settings, and mobile report tables expanding outside their scroll area. Existing design/layout direction retained. Production labels no longer incorrectly claim all workspaces are local.
- Patched the high-severity gRPC dependency through a locked 1.14.7 override; Firebase was not downgraded. Playwright was added as a development-only testing library; the server uses native Fetch/Web Crypto.

## Executed final results

| Validation | Actual result |
|---|---|
| Complete release allocation/security/compatibility/workflow/provisioning suite | **118 passed, 0 failed, 0 skipped; exit 0** |
| Complete existing regression suite against FINAL release rules | **128 passed, 0 failed, 0 skipped; exit 0** |
| Deployment guards + release-rule integrity + Cloudflare Function bundle checks | **7 passed, 0 failed; exit 0** |
| Headless Chrome functional browser groups | **16 passed; zero page exceptions** |
| All-module responsive visual matrix | **6 device/theme configurations passed: 1440, 768 and 390 pixels, light and dark; all eleven pages plus invoice preview** |
| Browser password-reset request | **Passed using the real Auth emulator** |
| TypeScript | Passed through independent check and guarded production build |
| Guarded Cloudflare production build | Passed, real project `growthmark-c0e9c`, emulator/preview flags false, numbered workflow true |
| Production dependency audit | **0 vulnerabilities** after patched override |
| Git/private-file preflight | Passed: 161 Git-safe files, no staged files, private/generated paths ignored and no detected private keys; regenerated after final documentation |

The main build chunk remains about 972 kB and produces Vite's existing >500 kB warning. This is a performance warning, not a failed build. Local Node 26 emits an existing Firebase CLI transitive engine warning; deployment is pinned to supported Node 24. Fourteen moderate development-tool advisories remain outside the shipped production dependency tree; no blanket or breaking `audit fix --force` was used.

The 128 regression assertions run against the exact final release rules. The two generic invoice-creation assertions now expect unnumbered creation denial, and their historical editing setup explicitly seeds legacy fixtures in a rules-disabled DISPOSABLE test context. No normal application creation route was restored. New numbered creation and direct attacks are covered by the release suite. This resolves the old baseline's payment-override read incompatibility without altering that historical rules file.

During implementation, a concurrent-signup test exposed missing-document transaction-lock contention. It was fixed with a create-only atomic commit plus a non-mutating access-policy precondition, bounded conflict retries and fresh reads. The final suite includes simultaneous initialization and suspension changed during creation, both passing. Test-harness selectors were corrected for required labels, normalized emulator email addresses, consumed OOB codes and the app's editor-close confirmation. No security condition was relaxed for those corrections.

## Browser scope and evidence

Tests use a separate headless Chrome profile, not the user's normal browser. Page requests are limited to loopback ports 5175, 9299 and 8380 and project `demo-growthmark-invoice-preview`. No production hosts or WhatsApp messages are contacted. Google/email provider settings in the real project were not changed.

Verified browser flows: real emulator registration and verification gating; onboarding; all sidebar pages; client create/edit; project creation; task creation/completion; quotation service and actual PDF download; Agency Profile/prefix saving; historical invoice inventory before local counter setup; GST/discount arithmetic; confirmed invoice reference; all six statuses without payment creation; manual append-only collections; saved override and original reset; actual invoice PDF download; WhatsApp message/URL handling without sending; pending request refresh recovery; historical invoice editing; UI eight-item pre-check; light/dark persistence; mobile navigation; two accounts and same-browser switching; persistent login; password-reset request. The existing regression suite also tests applying reset codes and logging in with the resulting password.

The expanded matrix checks eleven pages at all three viewport widths and both themes, plus invoice preview. Stable screenshots disable transitions for capture. The A4 preview intentionally scrolls horizontally on small screens; the overall page remains within the viewport. Chrome is tested; Safari, Firefox and physical-device behavior are not claimed. Server credential exchange is tested with an ephemeral in-memory test key and mocked Google responses; real IAM/Cloudflare/Firebase integration needs the separately approved production smoke test.

Ignored artifacts: `tests/security/results/browser-release/` contains screenshots, downloaded fixture PDFs and reports. Functional results are in `report.json`; responsive/password-reset results in `visual-report.json`. These are not safe-source Git uploads. Logs: `release.txt` (118) and `release-regression.txt` (128).

## Unexecuted production-only actions

Review actual deployed Firebase rules/domain/provider settings; approve and configure a dedicated server identity/encrypted Functions binding; approve/publish the complete release rules; inventory/reconcile and provision actual existing workspaces; configure the fixed launch cutoff and Cloudflare build/runtime settings; approve commit/push/deployment; then approve a real-account production smoke test. No code can safely replace these approvals by guessing history or embedding privileged browser credentials.

New automatic onboarding depends on the configured trusted endpoint. Without its production bindings the UI fails clearly and does not create a fallback workspace. Existing accounts without counters retain their data and other modules but require inventory before numbered creation. Ambiguous workspaces stay pending individually. Official issuance, public links, payment verification/gateways and retainer persistence remain intentionally unavailable.

Rollback must keep the protective rules, counters, request bindings and read-compatible frontend. Disable new creation via the release flag and redeploy a compatible artifact only after approval. Do not reset data, return to baseline rules, or deploy an old frontend that ignores overrides. The full exact instructions are in docs/release-runbook.md.

## Source files and safety boundary

The complete Git-safe upload manifest is docs/release-git-files.txt, generated by scripts/release-preflight.mjs. It includes prior reviewed work plus this release preparation; the index remains untouched. The release adds `server/`, `functions/api/workspace.js`, the trusted operator CLI, final rules/config, release guards, browser/server tests and runbooks; updates the necessary auth/invoice/settings-layout/build files and package lock; and adds only the narrow responsive fixes described above. The exact pending changed-file manifest is generated separately in docs/release-changed-files.txt.

The pre-existing `firestore.rules`, `firestore.agency-invoice.proposed.rules` and `firestore.production.proposed.rules` remain unchanged. `.env.local`, production Firebase settings/data, billing, users, production counters, Git commits/remotes/branches and Cloudflare deployment were not modified. The existing normal development emulators on 9099/8080 were not used/reset. Test/preview fixtures are disposable and clearly labelled QA; no fake records were presented as real business data.
