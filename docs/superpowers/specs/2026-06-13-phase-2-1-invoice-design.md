# Phase 2.1 — FCC Bill Generation (Invoice) Design

## Goal

Generate a monthly invoice per hospital that bundles:
1. TPA Desk fees for every claim discharged in the month (slab-priced from `HospitalBillingService`)
2. Fixed services (NABH, Empanelment, Document Processing) per the hospital's billing master
3. GST + TDS adjustments
4. Previous-balance roll-forward (unpaid prior invoices)

The user (operator) selects **month + hospital**, system computes everything, operator reviews, then issues. Issued invoices are immutable and printable.

## Prerequisites

- **Phase 2.0 Reference Master** must ship first. 2.1 itself does not compute commission, but every `InvoiceLineItem` must record `billingServiceNameId` (the global service-name FK, not just the hospital-specific service id) so the 2.2 commission engine can match against the reference's applicable-services list without joining through hospital configuration that may have changed since issue.

## Non-goals

- E-invoicing / GSTN integration (out of scope)
- Payment processing integrated with banks (handled later in 2.3 Cash/Bank)
- Editing claim amounts inside the invoice UI (operator must fix the claim, then regenerate)

## Data model

### New tables

```prisma
model Invoice {
  id                String          @id @default(uuid())
  invoiceNumber     String          @unique                  // FCC/2026-27/0001
  hospitalId        String          @map("hospital_id")
  month             DateTime                                  // 1st of invoice month, UTC
  status            String          @default("draft")        // draft | issued | partially_paid | paid | void
  issuedAt          DateTime?       @map("issued_at")
  dueDate           DateTime?       @map("due_date")

  // Snapshotted totals (Float = Decimal handled in JS; matches existing claim fields)
  subtotalTpaDesk   Float           @default(0) @map("subtotal_tpa_desk")
  subtotalServices  Float           @default(0) @map("subtotal_services")
  subtotalAdjust    Float           @default(0) @map("subtotal_adjustments")
  gross             Float           @default(0)              // Σ subtotals
  gstRate           Float           @default(0) @map("gst_rate")
  gstAmount         Float           @default(0) @map("gst_amount")
  tdsRate           Float           @default(0) @map("tds_rate")
  tdsAmount         Float           @default(0) @map("tds_amount")
  netTotal          Float           @default(0) @map("net_total")   // gross + gst − tds
  previousBalance   Float           @default(0) @map("previous_balance")
  grandTotal        Float           @default(0) @map("grand_total") // netTotal + previousBalance
  amountPaid        Float           @default(0) @map("amount_paid")
  amountPending     Float           @default(0) @map("amount_pending")

  notes             String          @default("")
  createdById       String?         @map("created_by_id")
  issuedById        String?         @map("issued_by_id")
  voidedAt          DateTime?       @map("voided_at")
  voidReason        String          @default("") @map("void_reason")
  createdAt         DateTime        @default(now()) @map("created_at")
  updatedAt         DateTime        @updatedAt @map("updated_at")

  hospital          Hospital        @relation(fields: [hospitalId], references: [id])
  createdBy         User?           @relation("InvoiceCreatedBy", fields: [createdById], references: [id])
  issuedBy          User?           @relation("InvoiceIssuedBy", fields: [issuedById], references: [id])
  lineItems         InvoiceLineItem[]

  @@unique([hospitalId, month])      // one invoice per hospital per month
  @@index([status])
  @@index([month])
  @@map("invoices")
}

model InvoiceLineItem {
  id                String   @id @default(uuid())
  invoiceId         String   @map("invoice_id")
  lineType          String   @map("line_type")              // claim_tpa_desk | service_fixed | service_percentage | adjustment
  description       String                                   // "TPA Desk — Patient X (CCN 1234)" or "NABH — Monthly"
  amount            Float    @default(0)
  order             Int      @default(0)

  // Optional refs — kept loose to avoid hard FK churn if claim/service deleted
  claimId               String?  @map("claim_id")
  billingServiceId      String?  @map("billing_service_id")        // HospitalBillingService.id (hospital-specific config)
  billingServiceNameId  String?  @map("billing_service_name_id")   // BillingServiceName.id (global catalog) — used by 2.2 commission engine

  // Snapshot context for audit
  meta              Json     @default("{}")                  // {hospitalFinalBill, finalApprovalAmount, slabMatched, referenceIdAtIssue}

  invoice           Invoice  @relation(fields: [invoiceId], references: [id], onDelete: Cascade)

  @@index([invoiceId])
  @@map("invoice_line_items")
}
```

### Hospital additions

```prisma
model Hospital {
  // ...existing fields
  gstRate           Float    @default(0) @map("gst_rate")    // e.g. 18
  tdsRate           Float    @default(0) @map("tds_rate")    // e.g. 10
  invoicePrefix     String   @default("FCC") @map("invoice_prefix")
  // existing referenceBy is reused for Phase 2.2 (commission)
  invoices          Invoice[]
}
```

### Claim changes

No schema change. `isBilled` and `filePrice` already exist; we will:
- Set `isBilled = true` on **issue** (not on draft) — so drafts can be discarded and regenerated.
- Set `filePrice` to the snapshotted TPA Desk fee at issue time (only if not already overridden).

## Generation algorithm

Inputs: `hospitalId`, `month` (1st of month, UTC).

```text
1. Reject if an issued/paid invoice already exists for (hospital, month).
   If a draft exists, return it for re-edit instead of creating a new one.

2. Fetch claims:
   WHERE hospitalId = ?
     AND dateOfDischarge BETWEEN [month, month+1)
     AND isBilled = false
     AND status NOT IN ('rejected', 'cancelled')   -- per ClaimStatus.slug

3. For each claim:
   tpaDeskFee = filePriceOverridden ? filePrice
              : calculateFilePrice(billingServices, hospitalFinalBill, finalApprovalAmount)
                  // existing util, filtered to billingType in ('per_claim_slab','percentage')
   push line: { type: 'claim_tpa_desk', description: 'TPA Desk — <patient> (CCN <ccnNo>)',
                amount: tpaDeskFee, claimId, meta: {...} }
   subtotalTpaDesk += tpaDeskFee

4. Fetch hospital's fixed services where billingType IN ('fixed_monthly', 'fixed_onetime').
   For each:
     - fixed_monthly: always added.
     - fixed_onetime: added only if no prior issued invoice for this hospital has a
       line with the same billingServiceId.
   push line: { type: 'service_fixed', description: '<service name> — Monthly|One-time',
                amount: fixedAmount, billingServiceId }
   subtotalServices += fixedAmount

5. gross = subtotalTpaDesk + subtotalServices + subtotalAdjust (0 initially; user can add)
   gstAmount = round(gross * gstRate / 100)
   tdsAmount = round(gross * tdsRate / 100)
   netTotal  = gross + gstAmount − tdsAmount

6. previousBalance = Σ amountPending of prior invoices for this hospital
                     where status IN ('issued','partially_paid')
   grandTotal = netTotal + previousBalance
   amountPending = grandTotal  (amountPaid = 0 on draft)

7. Persist Invoice + InvoiceLineItem rows in a single transaction.
   status = 'draft'. invoiceNumber assigned only on issue (step 8).
```

### Issue (separate action)

```text
1. Assign invoiceNumber: <prefix>/<FY>/<NNNN>
   where FY = "YYYY-YY" computed from issuedAt against Indian fiscal year (Apr 1 – Mar 31).
   Example: issuedAt = 2026-06-13 → FY = "2026-27"; issuedAt = 2027-02-10 → FY = "2026-27".
   NNNN = next sequence per FY (global, not per hospital).
2. Flip status to 'issued', set issuedAt + issuedById + dueDate (default issuedAt+15d).
3. For each line of type 'claim_tpa_desk': update Claim.isBilled = true,
   and set Claim.filePrice = line.amount when filePriceOverridden = false.
4. Recompute previousBalance & grandTotal at issue time (in case other invoices
   were paid in the interim) — drift safety.
```

### Void

- Only allowed on `issued` invoices with `amountPaid = 0`. Once any payment is recorded the invoice cannot be voided — operator must record a refund (out of scope for 2.1; will be addressed in 2.3 Cash/Bank).
- Sets `status = 'void'`, voids the number for the FY sequence (skip-and-record, do not reuse).
- Resets `isBilled = false` on linked claims so they can be reinvoiced.

## API surface

```
POST   /api/invoices/preview                { hospitalId, month } → computed totals + lines (no persist)
POST   /api/invoices                        { hospitalId, month } → creates draft
GET    /api/invoices                        ?hospitalId&status&month → list
GET    /api/invoices/:id                    → full invoice + lines
PATCH  /api/invoices/:id                    { notes, adjustments[] } → only on draft
POST   /api/invoices/:id/issue              → flips to issued
POST   /api/invoices/:id/void               { reason }
GET    /api/invoices/:id/pdf                → server-rendered PDF
DELETE /api/invoices/:id                    → only on draft
```

`adjustments[]` shape: `[{description, amount}]` — produces `lineType: 'adjustment'` rows. Negative amounts allowed (discounts).

RBAC module name: `invoices`. Permissions per existing pattern (view/create/edit/delete/export).

## UI surface

```
/invoices                 — list (filters: hospital, month, status)
/invoices/new             — wizard: pick hospital + month → preview → save draft
/invoices/:id             — detail/edit (drafts: editable adjustments+notes; issued: read-only + Print/Download PDF + Issue/Void buttons)
```

Reuse existing pages-pattern under `frontend/src/pages/invoices/`. Service layer: extend `frontend/src/services/api.js` with `invoiceApi`.

## Edge cases handled

| Case | Behaviour |
|---|---|
| No claims discharged this month, but hospital has `fixed_monthly` services | Invoice with only fixed-service lines + GST/TDS. Allowed. |
| No claims AND no fixed services | Preview returns empty; create blocked with clear error. |
| Claim later edited after invoice issued | Edit allowed (we don't lock claim), but `filePrice` snapshot on invoice does not change. Discrepancy surfaced in reports. |
| Hospital deleted with issued invoices | Hospital deletion already cascades elsewhere — add `onDelete: Restrict` on `Invoice.hospitalId` so invoice history survives. |
| Month rule misses a late-discharged claim | Operator can add an **adjustment** line manually as a stopgap; next month auto-pulls correctly. |
| FY sequence race on concurrent issues | Wrap issue in `prisma.$transaction` + a `SiteSetting` row `invoice.seq.<FY>` updated with optimistic version check. |

## Testing

- **Unit:** `calculateInvoiceTotals(claims, services, hospital, previousBalance)` — pure function, test slabs, percentage, fixed_monthly/onetime gating, GST/TDS rounding, sign of TDS.
- **Integration:** seed a hospital + 3 claims, hit `/preview`, then `/`, then `/issue`. Assert `isBilled` flipped, sequence assigned, previousBalance picks up unpaid prior invoice.
- **Smoke (manual):** generate for a real seeded hospital, verify PDF renders.

## Migration & rollout

1. Prisma migration: add `gstRate`, `tdsRate`, `invoicePrefix` to `Hospital`; create `Invoice` + `InvoiceLineItem`.
2. Seed: insert `invoices` module into `RoleModulePermission` for `super_admin` + `admin` (or whatever roles exist).
3. No backfill of existing claims; first invoice for each hospital just won't have a `previousBalance`.

## Open decisions deferred to implementation

- PDF renderer: `pdfkit` (already in node deps?) vs `puppeteer`. Will decide in plan based on what's installed. Default: server-side HTML → `pdfkit`.
- Adjustments rounding: stick to whole rupees (existing code uses `Math.round`).
- Currency formatting in UI: existing `₹` formatter in dashboard — reuse.

## What 2.1 explicitly does NOT include

- Payment recording (2.3)
- Reference Commission expense auto-creation (2.2, hooked from `POST /issue`)
- Reports (2.5)
- Bulk-issue-all-hospitals action (can be added later; YAGNI for now)
