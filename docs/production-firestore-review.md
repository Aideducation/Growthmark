# GrowthMark production Firestore rules — review only

Candidate: firestore.production.proposed.rules

Status: prepared and emulator-tested, NOT published. No production Firebase calls, rules changes, live records, user data deletion, billing changes, Git commit or push were performed.

## Comparison

This candidate is byte-for-byte identical to firestore.rules and firestore.agency-invoice.proposed.rules. SHA-256: edc4643d521b1fb93644750a66a9d0b1b3afc7fb024514df5a1e83c9e466d791. No rule permissions, schemas or behaviour changed. The separate filename identifies the exact candidate for review. Compared with the live deny-all policy described by the user, it would enable only the existing verified-owner operations if separately approved and published later; it is not active in production now.

## Access model

Email-verified Email/Password or Google accounts only. Workspace ID must equal Firebase Auth UID, and existing workspace ownership must match. New users can create their own profile/workspace atomically without subscriptions, payment, manual approval or an accountAccess document. A trusted suspension override blocks business access; clients cannot write, delete or list accountAccess records. No ordinary user can assign administrator privileges.

Existing clients, projects, tasks, draft quotations/invoices/items, private business/payment/invoice settings, and private Agency Profile/snapshots retain their tested permissions. Manual Payments remain owner-reported, append-only business records; this is not payment verification, a gateway or GrowthMark subscription billing. Retainers remain an unsaved planner; no new retainer permissions are introduced.

Ownership, identity, protected fields, exact document fields, server timestamps, revision increments, relationship checks and unknown-path denial remain. New advanced invoices commit header/items/snapshot together. Agency/client snapshots freeze at first save. Public invoice links, official issuance, numbering counters, privileged/admin operations, payment verification and unknown paths remain denied.

## Remaining scope limitations

Rules bound private JSON draft strings but cannot validate the detailed JSON contents or prove invoice financial consistency. Owners can submit deliberately inconsistent draft content through a custom client; they cannot use it to access another workspace or grant privileges. These rules must not be presented as immutable issued-invoice or verified-payment controls. Enhanced draft archiving remains unavailable under the current coordination policy. Shared Spark quotas and abuse controls remain operational considerations, not solved by this file.

## Tests actually run

Command: npm.cmd run test:security -- --production-rules

Result: 128 passed, 0 failed, 0 skipped; exit 0. Includes all original 110 tests, 8 calculation/PDF tests and 10 agency/invoice tests. Candidate selected explicitly in firebase.production-tests.json and all test helpers; only isolated demo-growthmark-security-tests at Auth 9199 / Firestore 8180 was used. No development emulator restart or production operations occurred. Disposable test fixtures are created and reset only inside those isolated test emulators.

Coverage: verified onboarding, two independent UIDs, anonymous/unverified/suspended denials, ownership/admin injection denial, all existing tested CRUD schemas, private bank/agency settings, snapshots and paired writes, stale updates/duplicate submissions, original deny reproduction, unknown paths and restricted financial operations. Maximum-size test saves 50 invoice lines plus a charges item, reads them, edits/reorders/removes lines and checks cross-user denial and exact summed estimates.

The old-rules regression test now uses a tracked rules-only fixture rather than an ignored backup. The new runner flag cannot start the development emulator. Existing default/agency test modes remain supported.

## Local files created or changed

New: firestore.production.proposed.rules; firebase.production-tests.json; tests/security/fixtures/firestore.pre-agency-invoice.rules; docs/production-firestore-review.md.

Updated test infrastructure only: scripts/run-security-tests.mjs; tests/security/helpers.mjs; tests/security/agency-invoice-security.test.mjs. Ignored test logs and QA PDFs were regenerated. Existing application features, original active/proposed rule files and production settings were not edited. Nothing was staged, committed or pushed.

## Complete candidate rules

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }
    function verifiedUser() {
      return signedIn()
        && request.auth.token.get('email_verified', false) == true
        && request.auth.token.firebase.sign_in_provider in ['password', 'google.com'];
    }
    // Missing override permits Stage 1 signup; only trusted administration can set it.
    function accountAllowed() {
      return verifiedUser() && (
        !exists(/databases/$(database)/documents/accountAccess/$(request.auth.uid))
        || (get(/databases/$(database)/documents/accountAccess/$(request.auth.uid)).data.userId == request.auth.uid
          && get(/databases/$(database)/documents/accountAccess/$(request.auth.uid)).data.status == 'active')
      );
    }
    function self(uid) { return accountAllowed() && uid == request.auth.uid; }
    function owner(wid) {
      return self(wid)
        && get(/databases/$(database)/documents/workspaces/$(wid)).data.ownerId == request.auth.uid;
    }
    function text(value, maximum) { return value is string && value.size() <= maximum; }
    function optionalDate(value) { return value == null || value is timestamp; }
    function exactKeys(d, fields) { return d.keys().hasAll(fields) && d.keys().hasOnly(fields); }
    function shape(d, fields) {
      return exactKeys(d, ['schemaVersion', 'workspaceId', 'ownerId', 'createdAt', 'updatedAt', 'revision'].concat(fields));
    }
    function metadata(d, wid) {
      return d.schemaVersion is int && d.schemaVersion == 1
        && d.workspaceId == wid && d.ownerId == request.auth.uid
        && d.revision is int && d.updatedAt == request.time
        && (request.method == 'create'
          ? d.createdAt == request.time && d.revision == 1
          : d.createdAt == resource.data.createdAt
            && d.ownerId == resource.data.ownerId
            && d.workspaceId == resource.data.workspaceId
            && d.schemaVersion == resource.data.schemaVersion
            && d.revision == resource.data.revision + 1);
    }
    function clientExists(wid, clientId) {
      return clientId is string && clientId.size() > 0
        && exists(/databases/$(database)/documents/workspaces/$(wid)/clients/$(clientId));
    }
    function relationship(wid, clientId, projectId) {
      return (clientId == null || clientExists(wid, clientId))
        && (projectId == null || (projectId is string && projectId.size() > 0 && clientId is string
          && get(/databases/$(database)/documents/workspaces/$(wid)/projects/$(projectId)).data.clientId == clientId));
    }
    function validClient(d) {
      return shape(d, ['name', 'company', 'email', 'phone', 'whatsapp', 'address', 'services', 'notes', 'status'])
        && text(d.name, 160) && d.name.size() > 0 && text(d.company, 160)
        && text(d.email, 254) && text(d.phone, 40) && text(d.whatsapp, 40)
        && text(d.address, 1000) && text(d.services, 2000) && text(d.notes, 5000)
        && d.status in ['active', 'inactive', 'archived'];
    }
    function validProject(d, wid) {
      return shape(d, ['clientId', 'name', 'description', 'serviceCategory', 'budgetMinor', 'startAt', 'deadlineAt', 'status', 'progressPercent', 'notes'])
        && clientExists(wid, d.clientId)
        && (request.method == 'create' || d.clientId == resource.data.clientId)
        && text(d.name, 160) && d.name.size() > 0 && text(d.description, 5000)
        && text(d.serviceCategory, 120) && d.budgetMinor is int && d.budgetMinor >= 0 && d.budgetMinor <= 1000000000000
        && optionalDate(d.startAt) && optionalDate(d.deadlineAt)
        && (d.startAt == null || d.deadlineAt == null || d.deadlineAt >= d.startAt)
        && d.status in ['planned', 'active', 'on-hold', 'completed', 'cancelled', 'archived']
        && d.progressPercent is int && d.progressPercent >= 0 && d.progressPercent <= 100
        && text(d.notes, 5000);
    }
    function validTask(d, wid) {
      return shape(d, ['clientId', 'projectId', 'title', 'description', 'priority', 'dueAt', 'status'])
        && relationship(wid, d.clientId, d.projectId)
        && text(d.title, 200) && d.title.size() > 0 && text(d.description, 5000)
        && d.priority in ['low', 'medium', 'high', 'urgent'] && optionalDate(d.dueAt)
        && d.status in ['todo', 'in-progress', 'completed', 'cancelled'];
    }
    function validDraft(d, wid) {
      return shape(d, ['clientId', 'projectId', 'title', 'state', 'issueAt', 'dueAt', 'terms', 'notes'])
        && clientExists(wid, d.clientId) && relationship(wid, d.clientId, d.projectId)
        && (request.method == 'create' || (d.clientId == resource.data.clientId && resource.data.state == 'draft'))
        && text(d.title, 200) && d.title.size() > 0 && d.state in ['draft', 'archived']
        && (request.method != 'create' || d.state == 'draft')
        && d.issueAt is timestamp && optionalDate(d.dueAt)
        && (d.dueAt == null || d.dueAt >= d.issueAt)
        && text(d.terms, 5000) && text(d.notes, 5000);
    }
    function validBusiness(d) {
      return shape(d, ['name', 'businessType', 'industry', 'email', 'phone', 'whatsapp', 'website', 'street', 'city', 'state', 'country', 'postalCode', 'gstin'])
        && text(d.name, 160) && d.name.size() > 0 && text(d.businessType, 100) && text(d.industry, 100)
        && text(d.email, 254) && text(d.phone, 40) && text(d.whatsapp, 40) && text(d.website, 500)
        && text(d.street, 1000) && text(d.city, 120) && text(d.state, 120) && text(d.country, 120)
        && text(d.postalCode, 30) && text(d.gstin, 30);
    }
    function validPaymentSettings(d) {
      return shape(d, ['upiId', 'accountHolder', 'bankName', 'accountNumber', 'ifsc', 'instructions'])
        && text(d.upiId, 200) && text(d.accountHolder, 160) && text(d.bankName, 160)
        && text(d.accountNumber, 80) && text(d.ifsc, 30) && text(d.instructions, 3000);
    }
    function validInvoiceSettings(d) {
      return shape(d, ['invoicePrefix', 'quotationPrefix', 'paymentTermsDays', 'footer', 'thankYouMessage', 'defaultTaxBps', 'defaultDiscountBps'])
        && text(d.invoicePrefix, 20) && text(d.quotationPrefix, 20)
        && d.paymentTermsDays is int && d.paymentTermsDays >= 0 && d.paymentTermsDays <= 365
        && text(d.footer, 2000) && text(d.thankYouMessage, 1000)
        && d.defaultTaxBps is int && d.defaultTaxBps >= 0 && d.defaultTaxBps <= 10000
        && d.defaultDiscountBps is int && d.defaultDiscountBps >= 0 && d.defaultDiscountBps <= 10000;
    }
    function readable(kind) { return kind in ['clients', 'projects', 'tasks', 'quotations', 'invoices', 'payments']; }
    function editable(kind, d, wid) {
      return (kind == 'clients' && validClient(d))
        || (kind == 'projects' && validProject(d, wid))
        || (kind == 'tasks' && validTask(d, wid))
        || (kind in ['quotations', 'invoices'] && validDraft(d, wid));
    }
    match /users/{uid} {
      allow get: if self(uid);
      allow list, delete: if false;
      allow create, update: if self(uid)
        && exactKeys(request.resource.data, ['schemaVersion', 'userId', 'workspaceId', 'fullName', 'email', 'phone', 'whatsapp', 'createdAt', 'updatedAt'])
        && request.resource.data.schemaVersion is int && request.resource.data.schemaVersion == 1
        && request.resource.data.userId == uid && request.resource.data.workspaceId == uid
        && request.resource.data.email == request.auth.token.email
        && text(request.resource.data.fullName, 160) && request.resource.data.fullName.size() > 0
        && text(request.resource.data.phone, 40) && text(request.resource.data.whatsapp, 40)
        && request.resource.data.updatedAt == request.time
        && getAfter(/databases/$(database)/documents/workspaces/$(uid)).data.ownerId == uid
        && (request.method == 'create' ? request.resource.data.createdAt == request.time
          : request.resource.data.createdAt == resource.data.createdAt);
    }
    match /accountAccess/{uid} {
      allow get: if signedIn() && request.auth.uid == uid;
      allow list, write: if false;
    }
    match /workspaces/{wid} {
      // Permit an owner to read their own absent path during resumable signup.
      allow get: if self(wid);
      allow list, delete: if false;
      allow create, update: if self(wid)
        && exactKeys(request.resource.data, ['schemaVersion', 'ownerId', 'name', 'currency', 'timezone', 'onboarding', 'createdAt', 'updatedAt'])
        && request.resource.data.schemaVersion is int && request.resource.data.schemaVersion == 1
        && request.resource.data.ownerId == request.auth.uid
        && text(request.resource.data.name, 160) && request.resource.data.name.size() > 0
        && request.resource.data.currency in ['INR', 'USD', 'EUR', 'GBP']
        && text(request.resource.data.timezone, 100) && request.resource.data.timezone.size() > 0
        && request.resource.data.onboarding in ['business-profile', 'complete']
        && request.resource.data.updatedAt == request.time
        && getAfter(/databases/$(database)/documents/users/$(wid)).data.workspaceId == wid
        && (request.method == 'create' ? request.resource.data.createdAt == request.time
          : resource.data.ownerId == request.auth.uid
            && request.resource.data.createdAt == resource.data.createdAt
            && request.resource.data.currency == resource.data.currency);
      match /settings/{settingId} {
        allow get: if owner(wid) && settingId in ['business', 'payment', 'invoice'];
        allow list, delete: if false;
        allow create, update: if owner(wid) && metadata(request.resource.data, wid)
          && ((settingId == 'business' && validBusiness(request.resource.data))
            || (settingId == 'payment' && validPaymentSettings(request.resource.data))
            || (settingId == 'invoice' && validInvoiceSettings(request.resource.data)));
      }

      // PROPOSAL ONLY: bounded private draft content. JSON is owner-authored, never trusted
      // for issuance, payment verification, counters, permissions or authoritative totals.
      function advancedEditable(invoiceId) {
        let path = /databases/$(database)/documents/workspaces/$(wid)/invoices/$(invoiceId)/configuration/snapshot;
        return !exists(path) || getAfter(path).data.revision == get(path).data.revision + 1;
      }
      function snapshotHeaderCommitted(invoiceId) {
        let path = /databases/$(database)/documents/workspaces/$(wid)/invoices/$(invoiceId);
        return getAfter(path).data.state == 'draft'
          && (!exists(path) ? getAfter(path).data.revision == 1
            : get(path).data.state == 'draft'
              && getAfter(path).data.revision == get(path).data.revision + 1);
      }
      match /settings/agency {
        allow get: if owner(wid);
        allow create, update: if owner(wid) && metadata(request.resource.data, wid)
          && shape(request.resource.data, ['profileJson'])
          && text(request.resource.data.profileJson, 150000);
        allow list, delete: if false;
      }
      match /invoices/{invoiceId}/configuration/snapshot {
        allow get: if owner(wid);
        allow list, delete: if false;
        allow create, update: if owner(wid) && metadata(request.resource.data, wid)
          && shape(request.resource.data, ['agencyJson','clientJson','contentJson'])
          && text(request.resource.data.agencyJson, 150000)
          && text(request.resource.data.clientJson, 10000)
          && text(request.resource.data.contentJson, 220000)
          && snapshotHeaderCommitted(invoiceId)
          && (request.method == 'create' || (
            resource.data.agencyJson == request.resource.data.agencyJson
            && resource.data.clientJson == request.resource.data.clientJson
            && get(/databases/$(database)/documents/workspaces/$(wid)/invoices/$(invoiceId)).data.state == 'draft'));
      }

      match /{kind}/{recordId} {
        allow get, list: if owner(wid) && readable(kind);
        allow create, update: if owner(wid) && metadata(request.resource.data, wid) && editable(kind, request.resource.data, wid) && (kind != 'invoices' || advancedEditable(recordId));
        allow delete: if false;
        match /items/{itemId} {
          function draftParent() {
            return kind in ['quotations', 'invoices']
              && ((kind == 'invoices' && !exists(/databases/$(database)/documents/workspaces/$(wid)/$(kind)/$(recordId)))
                || get(/databases/$(database)/documents/workspaces/$(wid)/$(kind)/$(recordId)).data.state == 'draft')
              && getAfter(/databases/$(database)/documents/workspaces/$(wid)/$(kind)/$(recordId)).data.state == 'draft';
          }
          allow get, list: if owner(wid) && kind in ['quotations', 'invoices'];
          allow create, update: if owner(wid) && draftParent() && (kind != 'invoices' || advancedEditable(recordId)) && metadata(request.resource.data, wid)
            && shape(request.resource.data, ['description', 'quantityMilli', 'unitPriceMinor', 'taxRateBps', 'discountBps'])
            && text(request.resource.data.description, 2000) && request.resource.data.description.size() > 0
            && request.resource.data.quantityMilli is int && request.resource.data.quantityMilli > 0 && request.resource.data.quantityMilli <= 1000000000
            && request.resource.data.unitPriceMinor is int && request.resource.data.unitPriceMinor >= 0 && request.resource.data.unitPriceMinor <= 1000000000000
            && request.resource.data.taxRateBps is int && request.resource.data.taxRateBps >= 0 && request.resource.data.taxRateBps <= 10000
            && request.resource.data.discountBps is int && request.resource.data.discountBps >= 0 && request.resource.data.discountBps <= 10000;
          allow delete: if owner(wid) && draftParent() && (kind != 'invoices' || advancedEditable(recordId));
        }
      }
      match /payments/{paymentId} {
        allow create: if owner(wid) && metadata(request.resource.data, wid)
          && shape(request.resource.data, ['clientId', 'projectId', 'amountMinor', 'currency', 'paidAt', 'method', 'transactionReference', 'notes', 'source'])
          && clientExists(wid, request.resource.data.clientId)
          && relationship(wid, request.resource.data.clientId, request.resource.data.projectId)
          && request.resource.data.amountMinor is int && request.resource.data.amountMinor > 0 && request.resource.data.amountMinor <= 1000000000000
          && request.resource.data.currency == get(/databases/$(database)/documents/workspaces/$(wid)).data.currency
          && request.resource.data.paidAt is timestamp && request.resource.data.paidAt <= request.time
          && request.resource.data.method in ['upi', 'bank-transfer', 'cash', 'other']
          && text(request.resource.data.transactionReference, 200) && text(request.resource.data.notes, 3000)
          && request.resource.data.source == 'owner-recorded';
        allow update, delete: if false;
      }
    }
    match /{document=**} { allow read, write: if false; }
  }
}
```
