# GrowthMark module expansion — local Stage 1

All eleven sidebar sections have actual hash routes and their own pages. Existing `#dashboard` and `#setup` anchors remain supported. The existing charcoal/emerald dashboard direction, responsive drawer and saved themes are reused. No client authentication is introduced.

## Functional status

“Functional” below means connected to the local demo Firestore project under the existing tested rules. It does not mean deployed or production-ready.

| Section | Working functionality | Pending / intentionally disabled |
| --- | --- | --- |
| Dashboard | Actual loaded client/project counts, monthly/all owner-recorded collections, invoice-draft estimates, task deadlines, recent payments, six-month collections chart | Authoritative issued revenue, outstanding invoice balances and overdue issued invoices |
| Clients | Create, edit, archive/reactivate through status editing, search/filter, details, related-record counts, collections total, CSV | Issued totals/outstanding receivables await issuance |
| Projects | Create/edit, client relationship, custom service text, exact minor-unit budget storage, start/deadline dates, status, progress, archive, view/search/filter/CSV | Advanced agency collaboration |
| Tasks | Create/edit, optional client/project relationships, priority, status, due dates, completion, search/filter/details/CSV; open overdue/upcoming tasks appear on dashboard | Background reminder delivery |
| Quotations | Draft create/edit/archive, service-line create/edit/remove, quantity/price/discount/tax estimates, document details, downloadable draft PDF | Formal sending/acceptance, immutable issued snapshots and conversion into an issued invoice |
| Invoices | Draft create/edit/archive, services, exact displayed calculations, details and downloadable draft PDF | Issuance, immutable numbers, financial snapshots, public payment links, settlement and paid/overdue statuses |
| Payments | Positive owner-recorded full/partial amount entries, date/method/reference/notes, immutable history, same-submission retry protection, search/filter/view/CSV, report totals | Verification, invoice allocations, authoritative balances, reversals/refunds and advanced audit controls |
| Retainers | Clearly labelled unsaved monthly schedule planner, including month-end date clamping | Saving agreements/billing periods is denied by current rules; no recurring invoices are generated |
| Reports | Actual recorded collections, date filters, client/project breakdowns, method breakdown, monthly chart, draft estimate total, CSV export | Issued revenue, receivables/overdue financial reports, retainer revenue and report PDF export |
| Business Profile | Private business/contact/address/GSTIN fields, business name synchronized to workspace, private bank/UPI text settings; owner information linked to Settings | Logo/QR/signature uploads require approved Storage integration |
| Settings | Owner name, phone/WhatsApp, validated timezone, current account email display, saved theme, prefixes/payment terms/footer/tax/discount defaults | Currency changes are blocked by existing immutable-currency rules; changing login email requires a separate verified workflow |

Retainer agreement storage could later be supported on Spark with a reviewed owner-only schema and local rule extension. It is not inherently a paid-backend feature. Automated invoice issuance and financial billing controls remain a separate trusted-backend stage. The present request retained the existing rules, so no retainer permission was added.

## Data and security boundaries

- Development stays on `demo-growthmark-security`, Auth 9099 / Firestore 8080, both loopback only. Real project `growthmark-c0e9c` and its deny-all rules remain unchanged.
- All write services derive UID from verified Auth, validate the local project, and validate ownership/revisions in transactions. No form accepts ownership metadata. Rules remain the final authorization boundary.
- Normalization permits only declared fields. New records get server timestamps, immutable ownership and revision 1. Updates preserve identity/creation metadata and increment revisions. Stale edits are rejected.
- Payment creation uses a stable submission ID and a transaction. A retry with identical content returns the existing entry; different content cannot replace it. Different submission IDs may still represent the same real payment, and entries are not independently verified.
- Private bank settings are not included in public endpoints or draft PDFs. No public endpoint exists in this phase.
- Issued-document fields, admin paths, public links, financial counters and retainers remain denied. No rule file permission was changed for this expansion.
- Queries initially load 100 records per section with a load-more action and an explicit partial-data warning when the limit is reached. Reports and CSV operate on loaded records; they are not advertised as exhaustive beyond that limit.
- Draft item listeners load at most 101 lines to detect the 100-line supported editor/export limit. PDFs are refused for documents exceeding it. A limit warning identifies partial loaded estimates.
- Unsubscribing and unmounting the workspace provider on session changes clears in-memory records; no private data is persisted to browser local storage.

## Calculations and documents

Amounts are stored in minor units. Decimal input is parsed with integer arithmetic; quantities use thousandths and rates use basis points. Displayed draft calculations use BigInt round-half-up arithmetic, per-line discount before tax, and reject unsafe totals. These estimates are never written as authoritative invoice totals.

PDFs are generated locally with jsPDF and an embedded openly licensed Noto Sans font. PDFs identify the business/client, dates, services, quantities/prices, discounts/taxes, terms, notes and totals. Every page is marked as a draft; no official number or verification is implied. Bank settings are excluded. Initial PDFs are English/Latin-oriented; broader script/font coverage is not claimed. Browser download handling can differ in embedded browsers.

CSV exports quote delimiters and protect formula-like text, including leading-whitespace variants. Financial exports contain owner-recorded provenance and currency.

## Executed verification

1. Navigation/shell stage: TypeScript/production build passed; the existing 96 security/application-service tests passed using isolated test emulators.
2. Connected module stage: TypeScript/production build passed after correcting inferred money-total types; expanded 107-test security/service suite passed.
3. Final stage: `npm run build` passed; `npm run test:security` executed **110 tests, 110 passed, 0 failed, 0 skipped**. This includes 11 new module-service tests, two multipage PDF tests and one CSV-injection test in addition to the earlier 96.

Actual final test output is in ignored `tests/security/results/latest.txt`. Generated multipage QA PDFs are in ignored `tests/security/results/qa-quotations.pdf` and `qa-invoices.pdf`.

Browser checks actually executed in a separate disposable `[QA] Module Testing Only` workspace on `localhost`, preserving the user's existing `127.0.0.1` login and records:
- All eleven destinations opened.
- Client create/search/edit/details, project and task creation, and persisted task date editing.
- Invoice and quotation draft creation, service lines and correct displayed totals; invoice date persistence; stored tax defaults applied to new quotation lines.
- PDF generation feedback for both draft types. Automated tests separately validated generated PDF headers, page structure, embedded font and draft metadata. Browser download-event capture itself was unreliable; file delivery in every embedded browser is not claimed.
- Manual payment entry was reflected in actual report and dashboard totals; payment history had no edit/delete actions.
- Invoice preferences and private banking text persisted across refresh.
- Retainer planner handled 31 January → 28 February and correctly disabled saving.
- Desktop layout/chart styling, mobile dark clients, 320px Business Profile without page overflow, and scrollable mobile tables.
- A fresh browser tab reported no captured console errors.

Browser testing found and fixed native date-input event handling, initial draft-loading state that could reset editor navigation, missing development stylesheet loading, and compressed mobile table columns. Some embedded-browser automation calls timed out and were retried in fresh tabs. Full device/browser coverage and exhaustive regression testing of every control remain future work.

## Test isolation and remaining issues

Tests now use `demo-growthmark-security-tests`, Auth 9199 / Firestore 8180, with a separate emulator configuration, hub/logging/websocket ports. They can run alongside development without clearing development data. The Auth service guard accepts only the two explicit demo-project/loopback-port pairs; live Auth remains disabled.

A preliminary attempt to export the existing development emulator failed; no process was stopped and no development data was reset. Isolation was implemented instead. No successful backup/restore capability is claimed.

The production build retains the existing large-chunk warning. PDF code is lazy loaded, but the main app still needs a later bundle-performance pass. Earlier CLI transitive-dependency/Node-26 compatibility warnings remain. Google popup limitations from Phase 2 are unchanged. No deployment, billing upgrade, live provider/rule change or live data write occurred.
