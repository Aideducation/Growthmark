# Step 6 — local allocation security and future rollout design

Status: LOCAL CANDIDATE ONLY. Nothing here authorizes deployment, production rules publication, counter initialization or live data changes.

## Protected identity

New invoice headers contain the following structured map, separate from editable snapshot JSON:

```text
allocation: {
  version: 1,
  workspaceId: authenticated UID,
  invoiceId: invoice document ID,
  requestId: stable allocation request ID,
  prefix: allocated prefix,
  sequence: allocated integer
}
itemIds: [ordered canonical item document IDs]
```

An accompanying `workspaces/{uid}/invoiceAllocations/{requestId}` document stores exactly `{ identity: <same map>, createdAt: server timestamp }`. Its creation must accompany the matching new invoice. Owners cannot update, delete or list these bindings. Private GET is allowed. The invoice's allocation map and the presence of that map are immutable; the existing number components also remain immutable. A request ID cannot be reused for another invoice because its binding cannot be replaced. Ownership always comes from verified Firebase Auth and the workspace path, never a form field.

The old `_allocation` JSON marker remains only for compatibility with earlier candidate snapshots. New recovery uses the validated protected header map. A missing, null or forged JSON marker cannot change recovery identity. An existing invoice without the protected map is not silently upgraded or accepted as a recoverable allocation, even if its JSON contains a convincing marker. It remains editable through the legacy path. Old pending candidate requests without protected identity require review; no automatic migration or reallocation is performed.

## Complete atomic creation and editing

New numbered creation requires all of the following in the same commit:

1. A counter update by exactly one, retaining its initialized baseline and protected metadata.
2. A previously absent invoice header with the matching sequence and current structured settings prefix.
3. The immutable request binding described above.
4. The required original agency/client/content snapshot at revision one.
5. Every item declared by the header's ordered, unique `itemIds` list.
6. Any selected invoice-specific payment override, validated independently.

Completeness is checked through a bounded item chain. The header checks item zero. Every written protected item validates its own index against the header, and requires the next declared item in the after-state. Every required item must carry the current header revision and request timestamp. This forces all declared items to participate in the same commit, including during edits. Extra unlisted items are denied. Removing a retained item, omitting a middle/last item, merely changing a manifest, or writing a header alone cannot pass.

Snapshot and header revision coordination and frozen agency/client strings remain in place. Existing invoice updates never touch the counter. Legacy headers without protected identity keep their old schema and may still edit fifty service lines plus a charges item. They cannot acquire protected allocation fields through an ordinary edit. Ordinary protected edits preserve the original identity and rewrite the coordinated item set.

This proves completeness of the declared canonical database records, not that owner-authored JSON represents mathematically authoritative financial data. Firestore rules cannot parse `contentJson` or establish its financial equivalence to item amounts. These remain private editable draft estimates. Official issuance, public payment links and verified payments are still disabled. The six manual labels do not create payments, verify funds or change collected revenue.

## Recovery

Invoice ID and request ID remain stable. The maximum remains three application attempts; the SDK transaction adapter uses one SDK attempt per application attempt. After an uncertain failure, server-backed recovery checks whether the invoice exists and verifies its protected workspace/invoice/request/prefix/sequence identity. Only matching committed identity is accepted. If absent, a retry requires demonstrable counter advancement, an unchanged baseline, and fresh authorization, reference and prefix checks. Every retry re-reads the transaction's required documents. Missing advancement, suspension, invalid references, mismatched identity and exhaustion fail clearly. No number is reused and no unnumbered fallback is created.

## Limits and the deliberate item-count change

The protected format supports **eight canonical item records total**, including an additional charges item: eight services without charges, or seven services plus charges. It does not retain the former 51-record limit for NEW protected allocations. Existing larger legacy invoices remain editable and are covered by a fifty-line-plus-charges test under both hardened and read-compatible rules.

Firestore allows ten rule document-access calls per operation and twenty across an atomic commit. With cached repeated paths, the conservative creation footprint at eight items is twenty distinct before/after accesses: workspace/access (2), client/project (2), settings (1), counter before/after (2), header before/after (2), snapshot before/after (2), binding after (1), and items (8). The header's path requires at most ten. The maximum case is executed with a project, an explicit active-account override and a payment override. Missing-item and over-limit attempts are separately denied. Increasing this limit is not a harmless UI change; it requires a different reviewed representation or trusted backend.

Creation writes at most thirteen documents, including override and binding. Snapshot strings together are capped at 900,000 UTF-8 bytes before writes, leaving room below the 1 MiB document limit for field names/metadata. Supported bounded payloads are comfortably below the 10 MiB request limit. No document needs more than two timestamp transforms, below the 500-transform-per-document limit. Transactions remain subject to Firestore's 270-second total/60-second idle limits and contention; three attempts can still exhaust under sustained load. Returned errors retain the request identity for explicit recovery.

References: [rule access limits](https://firebase.google.com/docs/firestore/security/rules-conditions), [Firestore quotas](https://firebase.google.com/docs/firestore/quotas).

## Payment compatibility and safe rollback

Loading and ordinary editing always read saved private payment overrides, independently of candidate creation mode. The old optional loader flag is retained for caller compatibility but no longer suppresses the read. Preview/PDF keep resolving against the invoice's original snapshot and its saved override. Current Agency Settings never replace those details. Denied or malformed override reads fail closed rather than falling back to different banking instructions.

The unchanged baseline rules deny even GET of a missing payment override. Consequently this frontend requires a reviewed owner-only GET permission before deployment. `firestore.invoice-read-compatibility.proposed.rules` is a SEPARATE transitional proposal: baseline permissions plus only this private GET. It adds no writes or public access. It is useful before the protected workflow is enabled; **it is not a safe rules rollback target after activation**, because it retains the baseline's old creation permissions and lacks the new identity protections. After activation, keep the hardened rules and disable creation through a compatible application release instead. An older frontend binary that ignores overrides is not a safe rollback target either.

## Future production rollout — design only, not executed

1. Independently retrieve/review the actual deployed rules and verify the project/database. Local proposal files are not evidence of the deployed rules. Back up rules and data through an authorized process. Agree the eight-item limit or approve a larger-format redesign before release.
2. Prepare a read-compatible application release/rollback artifact that understands protected headers and saved overrides even with creation disabled. Verify the Cloudflare production build uses real Firebase, not emulator/preview flags. The current candidate creation switch is still development-only; production enablement needs a separate reviewed change, not setting that flag to true.
3. Independently review and test the complete production rules derived from this hardened candidate, including every existing module. If a transitional reader release precedes activation, approve the owner-only read permission separately. Do not replace active hardened rules with the transitional baseline afterward.
4. Implement a separately authorized trusted provisioning process, outside the frontend and repository credentials. No production provisioning code or credentials were added in Step 6. A missing counter must block allocation. The emulator administrative initializer deliberately refuses real projects and must never be repurposed by removing its guards.
5. Inventory every existing workspace's actual stored headers, snapshots, legacy references, archived/cancelled invoices, imports and relevant external references. Reconcile document IDs AND extracted values, normalize leading zeros/case carefully, and investigate duplicates or ambiguity. Check all prefixes against a single monotonic workspace high-water mark. Supplied lists of document IDs alone are insufficient. Persist a reviewed inventory digest and evidence outside editable business documents.
6. Prevent legacy creation/imports and numbering changes during the final inventory/provisioning window. Freeze at an enforceable boundary, rescan immediately before create-only initialization, and stop if inventory changed. Set baseline/last sequence to the reviewed high-water mark; zero is allowed only for a provably empty workspace. Never overwrite or decrease an existing counter, rewrite historical numbers, or reset on prefix changes. Preserve audit evidence and verify the resulting counter read-only.
7. For new signups, trusted provisioning must verify Auth identity/email, ownership, suspension state and an empty history before creating a zero-baseline counter. Repeated provisioning must be idempotent and refuse existing counters. A human-only queue delays invoice availability; an open self-service launch therefore needs an approved automated trusted provisioner, or must keep numbered creation disabled. Do not allow normal users to initialize counters for convenience. No Firebase billing change is authorized; any backend hosting/service choice needs separate review.
8. Only after rules, trusted provisioning, inventories and isolated browser/mobile/theme/PDF checks pass, enable production creation in a controlled rollout. Keep readers/overrides and the protective rules when disabling creation during an incident. Retain stable pending IDs, monitor denied writes/contention, and investigate rather than resetting counters.

This is not a production-ready or deployed release. Browser visual sign-off, actual deployed-rule verification, production enablement and trusted provisioning remain outstanding.
