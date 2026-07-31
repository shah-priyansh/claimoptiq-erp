# Parent / Branch Hospitals with Consolidated Invoicing — Design

- **Date:** 2026-07-31
- **Status:** Approved (design) — pending implementation plan
- **Author:** Claude + Priyansh

## 1. Problem

Some hospitals operate a main entity plus one or more **branches**. Claims are
created against whichever hospital they belong to (the main hospital or a
specific branch). At invoice time the client wants to bill either:

- a **branch** on its own, or
- a **parent** hospital, consolidating the parent's own claims **plus** its
  branches' claims onto a single invoice,

and in the consolidated case still hand-pick exactly which claims land on the
invoice.

Today `Hospital` has no parent/child relationship, and invoice generation
selects claims by an **exact** `hospitalId` match, so cross-hospital billing is
impossible.

## 2. Decisions (locked)

1. **Hierarchy depth:** one level only — a hospital has at most one parent, and a
   branch cannot have its own sub-branches.
2. **Claim ownership:** each claim belongs to exactly one hospital (the parent
   *or* a specific branch). The parent link matters only at invoice time. No
   claim duplication.
3. **Invoice claim pool:** picking the **parent** as billing target makes the
   selectable pool = parent's own unbilled claims **+ all branches'** unbilled
   claims; picking a **branch** shows only that branch's claims.
4. **Billing rate:** a branch claim's charge is computed from **its own
   hospital's** billing rates — identical whether billed on its own branch
   invoice or on the parent's consolidated invoice.
5. **Fixed fees** (fixed_monthly / fixed_onetime): taken from the **billing
   (target) hospital only**. On a parent invoice, the parent's fixed fees appear
   once; branches' fixed fees are not auto-added.
6. **Previous balance:** reflects the **billing hospital's** own prior unpaid
   invoices only. Branch dues remain on branch invoices.
7. **Bulk "Generate Bill" flow:** included in scope. Branch claims consolidate
   under their parent.

## 3. Non-goals

- Multi-level hospital trees (branches of branches).
- Moving/duplicating a claim across hospitals.
- Changing direct-patient invoice behavior (unrelated stream).
- Reworking how per-claim `filePrice` is stored at claim creation.

## 4. Data model

Add a nullable self-relation to `Hospital` (`backend/prisma/schema.prisma`):

```prisma
model Hospital {
  // ... existing fields ...
  parentHospitalId String?    @map("parent_hospital_id")
  parent           Hospital?  @relation("HospitalBranches", fields: [parentHospitalId], references: [id])
  branches         Hospital[] @relation("HospitalBranches")
  // ...
  @@index([parentHospitalId])
}
```

- **Semantics:** `parentHospitalId != null` ⇒ this hospital is a **branch**.
  Having a non-empty `branches` ⇒ this hospital is a **parent**.
- **Migration:** additive, nullable column + index. No backfill; existing rows
  get `parentHospitalId = null` (standalone). Zero effect on existing claims and
  invoices.

### Validation (hospital create/update controller)

Reject with 400 when:

- `parentHospitalId === id` (self-parent).
- The chosen parent does not exist or is inactive.
- The chosen parent is itself a **branch** (`parent.parentHospitalId != null`) —
  enforces one level.
- This hospital already has **branches** of its own — a parent cannot become a
  branch, so it may not be assigned a parent.

These checks live in `hospitalController` create/update; the `all` list endpoint
and dropdown select already return `id, name, isActive` — extend the select to
include `parentHospitalId` so the frontend can compute badges and guard the
parent picker.

## 5. Backend changes

### 5.1 `buildInvoiceLines(hospitalId, month, opts)` — `invoiceController.js`

Currently the claim query filters `hospitalId` exactly and computes each claim's
TPA-desk amount from the **target** hospital's `services`. Changes:

1. **Resolve the branch set.** Before building the claim `where`, look up the
   target hospital's branches:
   `const branchIds = (await prisma.hospital.findMany({ where: { parentHospitalId: hospitalId }, select: { id: true } })).map(h => h.id)`.
   The billable hospital scope is `[hospitalId, ...branchIds]`.
2. **Claim filter** (regular invoices only; direct-patient unchanged): replace
   `{ hospitalId }` with `{ hospitalId: { in: scopeIds } }`. When explicit
   `claimIds` are supplied, the operator's selection still wins (existing
   behavior) — but the claim query must not silently include claims outside the
   scope; validate `claimIds` belong to `scopeIds`.
3. **Select `hospitalId` per claim** — add `hospitalId: true` to the claim
   `select` (currently absent).
4. **Per-claim charge from the claim's own hospital (decision 4).** Load billing
   services for **every hospital in `scopeIds`** (one `findMany` with
   `include: billingServices.slabs`), keyed by hospital id. For each claim, use
   `servicesByHospital.get(claim.hospitalId)` in `calculateFilePrice(...)`
   instead of the single target `services`. An overridden `filePrice` still
   wins, unchanged.
5. **Fixed fees & prior balance (decisions 5, 6)** stay bound to the **target**
   `hospitalId` — the fixed_monthly / fixed_onetime service list and the
   `priorOpen` query keep using `hospitalId`, not the scope. No change needed
   beyond keeping them separate from the per-claim path.
6. **Line metadata:** add the claim's source hospital name to each
   `claim_tpa_desk` line's `meta` (e.g. `sourceHospitalId`, `sourceHospitalName`)
   so the frontend can tag branch claims. Only populated when
   `claim.hospitalId !== hospitalId`.

### 5.2 `preview` — `invoiceController.js`

No signature change; it delegates to `buildInvoiceLines`. It already returns the
lines; the new per-line `meta.sourceHospitalName` flows through.

### 5.3 `previewBulk` — bulk grouping (decision 7)

Today it groups selected claims by exact `c.hospitalId` (one invoice per
hospital). Change the grouping key so a branch claim rolls up to its parent:

- Preload each selected claim's hospital `parentHospitalId`
  (the existing `allSelected` query already selects `hospitalId`; add a hospital
  lookup for `parentHospitalId`, or join).
- `groupKey = claim.hospital.parentHospitalId ?? claim.hospitalId`.
- The group's `hospitalId` (billing target) = `groupKey`.
- Everything downstream (`buildInvoiceLines(groupKey, ...)`) then naturally
  pulls the right scope and per-claim rates via §5.1.
- Hospitals **without** a parent are unaffected (groupKey == their own id).

### 5.4 Marking claims billed — no change

`exports.create` collects `claimIds` from the invoice's `claim_tpa_desk` line
items (line ~1180) and sets `isBilled: true` by claim id (line ~1244). Because
this is claim-id based, branch claims on a parent invoice are marked billed
correctly and cannot be double-billed. Confirmed, no change required.

## 6. Frontend changes

### 6.1 Hospital master (`HospitalForm.js`, hospital list)

- Add an optional **"Parent hospital"** searchable picker. Options exclude: the
  hospital itself, hospitals that already have a parent (branches), and
  hospitals that already have branches (parents) — mirroring the backend guard.
- Hospital list: small badge — "Branch of {parent}" on a branch, "{n} branches"
  on a parent.

### 6.2 Single Invoice Wizard (`InvoiceWizard.js`) — primary UX

- Billing-hospital picker unchanged in mechanics; add a hint badge when the
  picked hospital is a parent (e.g. "+3 branches — their claims are included").
- Preview line rows: when a line carries `meta.sourceHospitalName`, show a small
  tag (e.g. "— ICON PLUS (branch)") so the operator sees each claim's origin.
- Per-line **remove** already exists (rows.filter on delete) — this is the
  hand-select mechanism. No new selection UI required.
- The billing hospital saved on the invoice = whatever was picked (parent or
  branch), exactly as chosen.

### 6.3 Bulk Invoice Wizard (`BulkInvoiceWizard.js`)

- Consumes `previewBulk` output; with §5.3 the previews already come back
  consolidated under the parent. Show the parent as the group hospital and tag
  branch-sourced claim lines the same way as §6.2.

## 7. Edge cases

- **A branch has claims but the parent is picked, and the operator removes all
  branch lines** → a valid parent-only invoice. Fine.
- **Claim's hospital has no billing services** → existing default-cashless-TPA
  fallback (`useDefaultCashlessTpa`) applies per that hospital, using the same
  BillingServiceName master. Preserved by keying services per hospital.
- **Parent + branch both invoiced same month** → different `hospitalId`, so the
  partial unique index `(hospitalId, month, isDirectPatient)` does not collide;
  `isBilled` prevents a claim landing on both.
- **Reassigning a hospital's parent after some of its claims are billed** → past
  invoices are immutable (line items already persisted); only future previews
  use the new scope. Acceptable.
- **Setting a parent that would create a 2-node cycle** (A→B and B→A) → blocked
  by the "chosen parent must not itself be a branch" rule.

## 8. Testing

- **Schema/migration:** migrate on a copy; assert existing hospitals get
  `parentHospitalId = null` and existing invoice generation is byte-identical
  for standalone hospitals.
- **Validation:** unit-test the four rejection rules in the hospital controller.
- **buildInvoiceLines:** with a parent + 2 branches, assert the preview includes
  parent+branch unbilled claims; assert each branch claim's amount equals what
  the branch alone would produce (own-hospital rates); assert fixed fees =
  parent's only; assert prior balance = parent's only.
- **previewBulk:** select a mix of parent + branch claims → one consolidated
  preview under the parent; standalone hospital claims still one-per-hospital.
- **Create + isBilled:** create a parent consolidated invoice; assert every
  included branch claim flips `isBilled = true` and is excluded from subsequent
  previews.
- **End-to-end:** drive the InvoiceWizard for a parent hospital, remove one
  branch line, generate, verify totals and the persisted invoice.

## 9. Rollout

- Additive migration, opt-in feature (null parent = today's behavior), so it can
  ship without a data migration or feature flag. Standalone hospitals see no
  change.
