# Phase 2.0 — Reference Master Design

## Goal

Promote "Reference By" from a free-text string on `Hospital` to a first-class master entity. The Reference holds the commission configuration (rate + which services trigger it). 2.0 ships the master and its hookup; 2.2 ships the commission-on-bill auto-flow that consumes it.

## Why this is a prerequisite

- 2.1 Invoice writes line items per service. The commission engine in 2.2 must, for each issued line, look up: which reference is on the hospital, is this service eligible, what percentage. That lookup needs a structured FK, not a string match.
- The current `Hospital.referenceBy` string appears in `HospitalForm`, `HospitalList`, `Reports`, and the import flow. We keep the string for back-compat and add the FK alongside it.

## Data model

```prisma
model Reference {
  id              String     @id @default(uuid())
  name            String
  mobile          String     @default("")
  address         String     @default("")
  commissionRate  Float      @default(0) @map("commission_rate")   // percentage, e.g. 5 = 5%
  isActive        Boolean    @default(true) @map("is_active")
  createdAt       DateTime   @default(now()) @map("created_at")
  updatedAt       DateTime   @updatedAt @map("updated_at")

  applicableServices ReferenceApplicableService[]
  hospitals          Hospital[]

  @@index([name])
  @@map("references")
}

// Multi-select join: which BillingServiceName entries this reference earns commission on.
// Using BillingServiceName (the global service catalog) — NOT HospitalBillingService —
// so a reference's eligibility is portable across hospitals.
model ReferenceApplicableService {
  id                  String              @id @default(uuid())
  referenceId         String              @map("reference_id")
  billingServiceNameId String             @map("billing_service_name_id")

  reference            Reference          @relation(fields: [referenceId], references: [id], onDelete: Cascade)
  billingServiceName   BillingServiceName @relation(fields: [billingServiceNameId], references: [id], onDelete: Cascade)

  @@unique([referenceId, billingServiceNameId])
  @@map("reference_applicable_services")
}
```

### Hospital changes

```prisma
model Hospital {
  // ...existing fields, including referenceBy (kept as denormalized name)
  referenceId   String?    @map("reference_id")
  reference     Reference? @relation(fields: [referenceId], references: [id])
  // ...
}
```

**Why keep `referenceBy` string?** It is wired into `Reports.js`, `HospitalList`, and the import sample row. Removing it would force a multi-file rip-up unrelated to 2.0's goal. Instead:
- On hospital create/edit, if `referenceId` is set, auto-fill `referenceBy` with `reference.name` (snapshot for legacy consumers).
- Existing rows with only `referenceBy` set continue to render; they just don't earn commission until the operator picks a Reference.

### BillingServiceName changes

```prisma
model BillingServiceName {
  // ...existing fields
  referenceApplicableTo ReferenceApplicableService[]
}
```

## Generation algorithm

None — this is master CRUD. The interesting logic ("compute commission for an invoice") lives in 2.2 and reads from this master.

## API surface

```
GET    /api/references            ?search&isActive → list with applicableServices populated
GET    /api/references/:id        → full detail
POST   /api/references            → create
PATCH  /api/references/:id        → update (commissionRate, services replaced as a whole on PATCH)
DELETE /api/references/:id        → soft-delete via isActive=false if referenced by any hospital; hard-delete if not
GET    /api/references/:id/hospitals → hospitals linked to this reference (for "where used")
```

Service replacement on PATCH: client sends full `applicableServiceIds: string[]`; server diffs against existing rows and applies in a transaction. Avoids "add one / remove one" endpoints.

### Hospital API additions

- `POST /api/hospitals` and `PATCH /api/hospitals/:id` accept `referenceId`. On save, server auto-syncs `referenceBy = reference.name` when `referenceId` is provided.
- `GET /api/hospitals` already supports `include` patterns — extend to optionally include `reference`.

RBAC module name: `references`. Standard view/create/edit/delete/export.

## UI surface

```
/references                — list (search, active filter, applicable-services chips)
/references/new            — form: name, mobile, address, commission %, services multi-select
/references/:id/edit       — same form
```

`HospitalForm` change: replace the free-text "Reference By" input with a searchable dropdown of references (fall back to the legacy text field when no references exist or operator clears the dropdown). Path: `frontend/src/pages/hospitals/HospitalForm.js:244`.

`HospitalList` columns: keep "Reference By" column rendering `hospital.reference?.name ?? hospital.referenceBy`.

`Reports.js` reference filter (`frontend/src/pages/reports/Reports.js:75`): extend the "distinct values" source to union `references.name` with legacy `hospital.referenceBy` strings so filtering still works during transition.

## Edge cases

| Case | Behaviour |
|---|---|
| Reference deleted while hospitals point to it | Block delete; require operator to unlink or use soft-delete (`isActive=false`). |
| Hospital's reference cleared after invoices were issued | Old invoice's commission record (created in 2.2) is preserved — commission is snapshot at invoice-issue, not recomputed. |
| Commission rate changed after issue | Same — snapshot wins. Future invoices use new rate. |
| Reference has zero applicable services | Allowed (operator may be mid-setup). No commission earned until services are picked. |
| Bulk import of hospitals with `referenceBy` string | Importer is unchanged. Operator can attach a Reference afterwards via Hospital edit. |
| Soft-deleted reference still attached to a hospital | Hospital UI shows it greyed out with a "(inactive)" badge; commission engine in 2.2 skips inactive references. |

## Testing

- **Unit:** N/A (no compute logic in 2.0).
- **Integration:** create reference with 2 applicable services → attach to hospital → GET hospital with `?include=reference` returns rate + services. Detach reference; verify referenceBy snapshot stays.
- **Manual smoke:** existing Reports "Reference By" filter still lists values; HospitalForm dropdown shows references and falls back to text.

## Migration & rollout

1. Prisma migration: create `references`, `reference_applicable_services`; add `referenceId` to `hospitals`. Do NOT drop `referenceBy`.
2. Backfill (optional, deferred): script that proposes Reference records for each distinct `Hospital.referenceBy` value; operator confirms in UI. Not blocking 2.0 ship.
3. Seed: insert `references` module into `RoleModulePermission` for super_admin + admin.

## What 2.0 does NOT include

- Commission calculation (2.2)
- Commission expense auto-creation (2.2)
- Backfill UI for migrating legacy `referenceBy` strings (defer to operator-driven workflow)
