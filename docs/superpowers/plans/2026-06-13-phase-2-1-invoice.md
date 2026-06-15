# Phase 2.1 — Invoice (FCC Bill) Implementation Plan

**Goal:** Monthly invoice per hospital bundling TPA Desk fees (slab-priced per claim), fixed services, GST/TDS, and previous-balance roll-forward. Operator picks `(hospital, month)` → preview → save draft → issue (immutable, numbered, PDF). Void allowed only pre-payment.

**Architecture:** Prisma models `Invoice` + `InvoiceLineItem`. Pure `calculateInvoiceTotals(claims, services, hospital, previousBalance)` util. Express controller exposes preview/create/list/get/update(draft)/issue/void/delete/pdf. FY sequence stored in `SiteSetting` row `invoice.seq.<FY>` updated in the issue transaction. PDF via `pdfkit`. Frontend list + wizard + detail under `/invoices`.

**Testing convention:** Same as 2.0 — bash+curl smoke script. No jest infrastructure added.

**Tip:** Feature branch `phase-2-1-invoice` (continues from `phase-2-0-reference-master` after merge).

---

## File map

**Create:**
- `backend/prisma/migrations/<ts>_add_invoice/migration.sql` (Prisma generated)
- `backend/utils/calculateInvoiceTotals.js`
- `backend/utils/invoiceSequence.js` (FY sequence helper)
- `backend/utils/renderInvoicePdf.js`
- `backend/controllers/invoiceController.js`
- `backend/routes/invoiceRoutes.js`
- `backend/scripts/smoke-invoice.sh`
- `frontend/src/pages/invoices/InvoiceList.js`
- `frontend/src/pages/invoices/InvoiceWizard.js`
- `frontend/src/pages/invoices/InvoiceDetail.js`

**Modify:**
- `backend/prisma/schema.prisma` (add Invoice, InvoiceLineItem; Hospital.gstRate/tdsRate/invoicePrefix; User back-relations)
- `backend/seed.js` (add `invoices` module; perms for super_admin + fcc_staff)
- `backend/server.js` (mount `/api/invoices`)
- `backend/package.json` (add pdfkit dependency)
- `frontend/src/services/api.js` (invoice API client)
- `frontend/src/App.js` (`/invoices` routes)
- `frontend/src/components/layout/Sidebar.js` (Invoices entry under main nav)

---

## Task 1 — Schema + migration

Add to `schema.prisma`:

```prisma
model Invoice {
  id                String   @id @default(uuid())
  invoiceNumber     String?  @unique @map("invoice_number")
  hospitalId        String   @map("hospital_id")
  month             DateTime
  status            String   @default("draft")
  issuedAt          DateTime? @map("issued_at")
  dueDate           DateTime? @map("due_date")

  subtotalTpaDesk   Float    @default(0) @map("subtotal_tpa_desk")
  subtotalServices  Float    @default(0) @map("subtotal_services")
  subtotalAdjust    Float    @default(0) @map("subtotal_adjustments")
  gross             Float    @default(0)
  gstRate           Float    @default(0) @map("gst_rate")
  gstAmount         Float    @default(0) @map("gst_amount")
  tdsRate           Float    @default(0) @map("tds_rate")
  tdsAmount         Float    @default(0) @map("tds_amount")
  netTotal          Float    @default(0) @map("net_total")
  previousBalance   Float    @default(0) @map("previous_balance")
  grandTotal        Float    @default(0) @map("grand_total")
  amountPaid        Float    @default(0) @map("amount_paid")
  amountPending     Float    @default(0) @map("amount_pending")

  notes             String   @default("")
  createdById       String?  @map("created_by_id")
  issuedById        String?  @map("issued_by_id")
  voidedAt          DateTime? @map("voided_at")
  voidReason        String   @default("") @map("void_reason")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  hospital  Hospital @relation(fields: [hospitalId], references: [id], onDelete: Restrict)
  createdBy User?    @relation("InvoiceCreatedBy", fields: [createdById], references: [id])
  issuedBy  User?    @relation("InvoiceIssuedBy", fields: [issuedById], references: [id])
  lineItems InvoiceLineItem[]

  @@unique([hospitalId, month])
  @@index([status])
  @@index([month])
  @@map("invoices")
}

model InvoiceLineItem {
  id                   String  @id @default(uuid())
  invoiceId            String  @map("invoice_id")
  lineType             String  @map("line_type")
  description          String
  amount               Float   @default(0)
  order                Int     @default(0)
  claimId              String? @map("claim_id")
  billingServiceId     String? @map("billing_service_id")
  billingServiceNameId String? @map("billing_service_name_id")
  meta                 Json    @default("{}")
  invoice              Invoice @relation(fields: [invoiceId], references: [id], onDelete: Cascade)

  @@index([invoiceId])
  @@map("invoice_line_items")
}
```

Add to `Hospital`:
```prisma
  gstRate       Float    @default(0) @map("gst_rate")
  tdsRate       Float    @default(0) @map("tds_rate")
  invoicePrefix String   @default("FCC") @map("invoice_prefix")
  invoices      Invoice[]
```

Add to `User`:
```prisma
  invoicesCreated Invoice[] @relation("InvoiceCreatedBy")
  invoicesIssued  Invoice[] @relation("InvoiceIssuedBy")
```

Generate migration: `cd backend && npx prisma migrate dev --name add_invoice` (fall back to `migrate deploy` if drift).

Commit: `feat(phase-2-1): invoice + line item schema`

---

## Task 2 — Seed `invoices` module RBAC

Add `'invoices'` to `allModules`; grant `super_admin` full perms (view/create/edit/delete/export) and `fcc_staff` `{ view: true, create: true, edit: true }`. Run `npm run seed`, verify.

Commit: `feat(phase-2-1): seed invoices module RBAC`

---

## Task 3 — Install pdfkit

```bash
cd backend && npm install pdfkit
```

Commit: `chore(phase-2-1): add pdfkit dependency`

---

## Task 4 — `calculateInvoiceTotals` util (pure)

Create `backend/utils/calculateInvoiceTotals.js` exporting a pure function:

```js
function calculateInvoiceTotals({ tpaDeskLines, fixedServiceLines, adjustmentLines, gstRate, tdsRate, previousBalance }) {
  const subtotalTpaDesk  = sum(tpaDeskLines);
  const subtotalServices = sum(fixedServiceLines);
  const subtotalAdjust   = sum(adjustmentLines);   // negative allowed (discounts)
  const gross     = subtotalTpaDesk + subtotalServices + subtotalAdjust;
  const gstAmount = Math.round(gross * (gstRate || 0) / 100);
  const tdsAmount = Math.round(gross * (tdsRate || 0) / 100);
  const netTotal  = gross + gstAmount - tdsAmount;
  const grandTotal    = netTotal + (previousBalance || 0);
  const amountPending = grandTotal;
  return { subtotalTpaDesk, subtotalServices, subtotalAdjust, gross, gstAmount, tdsAmount, netTotal, grandTotal, amountPending };
}
```

No tests file (project convention). Sanity: `node -e "console.log(require('./backend/utils/calculateInvoiceTotals')({tpaDeskLines:[{amount:100}],fixedServiceLines:[],adjustmentLines:[],gstRate:18,tdsRate:10,previousBalance:0}))"` → produces correct totals.

Commit: `feat(phase-2-1): pure invoice totals util`

---

## Task 5 — `invoiceSequence` util (FY + sequence)

Create `backend/utils/invoiceSequence.js`:
- `getFiscalYear(date)` → `"YYYY-YY"` (April rollover).
- `nextInvoiceNumber(tx, prefix, date)` → atomically reads/upserts `SiteSetting` row `key="invoice.seq.<FY>"`, increments JSON `{ seq: N }`, returns formatted `<prefix>/<FY>/<NNNN>`.

Wrap in a transaction inside the controller's issue handler.

Commit: `feat(phase-2-1): FY sequence util for invoice numbering`

---

## Task 6 — `renderInvoicePdf` util

Create `backend/utils/renderInvoicePdf.js` exporting `(invoice, hospital) => Buffer` using pdfkit. Sections:
- Header: prefix logo placeholder, "FCC Tax Invoice", invoiceNumber, issuedAt, dueDate
- Hospital block: name, address, GSTIN placeholder
- Line items table grouped by type (TPA Desk / Services / Adjustments)
- Totals block: subtotals, GST, TDS, netTotal, previousBalance, grandTotal
- Footer: notes, "computer-generated, no signature required"

Returns a promise resolving to a Buffer.

Commit: `feat(phase-2-1): invoice PDF renderer`

---

## Task 7 — Invoice controller

Create `backend/controllers/invoiceController.js`. Use the spec algorithm verbatim. Key handlers:

- `preview(req, res)` — compute lines + totals from `(hospitalId, month)` without persisting. Validate month is YYYY-MM-01. Return `{ lines, totals, previousBalance }`.
- `create(req, res)` — if draft exists for `(hospital, month)` return it; else build lines (TPA Desk per claim using `calculateFilePrice` filtered to `per_claim_slab|percentage`; fixed_monthly always; fixed_onetime only if no prior issued invoice has matching `billingServiceId`); save Invoice + LineItems in one `$transaction`; status `draft`. Block create if no lines.
- `list(req, res)` — `?hospitalId, status, month` with pagination.
- `getOne(req, res)` — include hospital + createdBy/issuedBy + lineItems.
- `update(req, res)` — only when `status='draft'`; allow `notes` + replace `adjustments[]` rows; recompute totals.
- `issue(req, res)` — transaction: recompute previousBalance, assign invoiceNumber via `nextInvoiceNumber`, set `issuedAt = now`, `issuedById = req.user.id`, `dueDate = issuedAt + 15d`, flip `Claim.isBilled = true` for tpa_desk lines + set `Claim.filePrice` if not overridden.
- `void(req, res)` — only `status='issued'` with `amountPaid=0`. Set `voidedAt`, `voidReason`, `status='void'`, reset `isBilled=false` on linked claims. Sequence number is **not** reused (skip-and-record).
- `remove(req, res)` — only `status='draft'`.
- `pdf(req, res)` — render with `renderInvoicePdf`, send `application/pdf`.

Commit: `feat(phase-2-1): invoice controller (preview/create/list/get/update/issue/void/delete/pdf)`

---

## Task 8 — Routes + server mount

Create `backend/routes/invoiceRoutes.js` with per-route `checkPermission`:
- `POST /preview` view (compute only — view perm)
- `POST /` create
- `GET /` view, `GET /:id` view
- `PATCH /:id` edit
- `POST /:id/issue` edit
- `POST /:id/void` edit
- `DELETE /:id` delete
- `GET /:id/pdf` view

Mount in `server.js` after billing-service-names: `app.use('/api/invoices', require('./routes/invoiceRoutes'));`.

Commit: `feat(phase-2-1): mount /api/invoices`

---

## Task 9 — Backend smoke script

Create `backend/scripts/smoke-invoice.sh`. Coverage:
1. Login.
2. Pick a hospital (with active billing services and >0 admitted/discharged claims).
3. Pick a month with discharged unbilled claims.
4. POST `/preview` — assert lines + grandTotal > 0.
5. POST `/` — draft created.
6. PATCH adjustments [{description:"Goodwill discount", amount:-100}] — totals recomputed.
7. POST `/:id/issue` — invoiceNumber assigned (matches `FCC/\\d{4}-\\d{2}/\\d{4}`), status=`issued`.
8. POST `/:id/void` `{reason:"test"}` — status=`void`, linked claims isBilled reset.
9. GET `/` filter status=`void` — invoice present.

Exits non-zero on any failure.

Commit: `test(phase-2-1): invoice smoke script`

---

## Task 10 — Frontend API client

Add to `frontend/src/services/api.js`:
```js
export const previewInvoiceAPI = (data) => API.post('/invoices/preview', data);
export const createInvoiceAPI  = (data) => API.post('/invoices', data);
export const getInvoicesAPI    = (params) => API.get('/invoices', { params });
export const getInvoiceAPI     = (id) => API.get(`/invoices/${id}`);
export const updateInvoiceAPI  = (id, data) => API.patch(`/invoices/${id}`, data);
export const issueInvoiceAPI   = (id) => API.post(`/invoices/${id}/issue`);
export const voidInvoiceAPI    = (id, data) => API.post(`/invoices/${id}/void`, data);
export const deleteInvoiceAPI  = (id) => API.delete(`/invoices/${id}`);
export const invoicePdfUrl     = (id) => `${API.defaults.baseURL}/invoices/${id}/pdf`;
```

Commit: `feat(phase-2-1): invoice API client`

---

## Task 11 — Invoice list page

Create `frontend/src/pages/invoices/InvoiceList.js`. Columns: invoiceNumber (or `Draft #<short>`), Hospital, Month, Status badge, Grand Total, Paid, Pending, Actions (view/delete-draft). Filters: hospital, month, status. PaginationBar. RBAC-gated buttons via `can('invoices', 'create'/'delete')`.

Commit: `feat(phase-2-1): invoice list page`

---

## Task 12 — Invoice wizard (new)

Create `frontend/src/pages/invoices/InvoiceWizard.js`. Steps:
1. Pick hospital (dropdown of active hospitals) + month (month input).
2. Call `previewInvoiceAPI` — show lines grouped by type, totals.
3. Submit `createInvoiceAPI` → redirect to detail.

Commit: `feat(phase-2-1): invoice creation wizard`

---

## Task 13 — Invoice detail/edit

Create `frontend/src/pages/invoices/InvoiceDetail.js`. Draft mode: editable adjustments + notes, Save / Issue / Delete buttons. Issued mode: read-only, Print PDF (opens `invoicePdfUrl`), Void button (with reason prompt) gated on `amountPaid === 0`. Voided: read-only + void reason banner.

Commit: `feat(phase-2-1): invoice detail/edit page`

---

## Task 14 — Routes + Sidebar

`App.js`: add `/invoices`, `/invoices/new`, `/invoices/:id` routes wrapped in `<ProtectedRoute module="invoices" requireManage>`. Sidebar: add Invoices entry to main nav (between Claims and Reports — it's an operational module, not admin).

Commit: `feat(phase-2-1): invoice routes + sidebar entry`

---

## Task 15 — E2E verification

- Run `bash backend/scripts/smoke-invoice.sh` (after smoke seeds exist).
- Frontend `npm run build` clean.
- Browser walk: create draft → preview lines → issue → PDF opens → void with reason.

---

## Spec coverage check

| Spec requirement | Task |
|---|---|
| Invoice model with snapshotted totals + status flow | 1 |
| InvoiceLineItem with billingServiceNameId for 2.2 commission engine | 1 |
| Hospital gstRate/tdsRate/invoicePrefix | 1 |
| `onDelete: Restrict` on hospital FK | 1 |
| RBAC `invoices` module | 2 |
| Pure totals util | 4 |
| FY sequence via SiteSetting | 5 |
| PDF rendering | 3, 6 |
| Preview / create / list / get / update / issue / void / delete / pdf endpoints | 7, 8 |
| `fixed_onetime` gating by prior issued invoices | 7 |
| `previousBalance` roll-forward & recompute on issue | 7 |
| `isBilled` flip + filePrice snapshot on issue | 7 |
| Void resets `isBilled` | 7 |
| List + wizard + detail UI | 11, 12, 13 |
| Sidebar + routes | 14 |
| Smoke | 9, 15 |

Open carryover from spec: e-invoicing/GSTN, payment recording, bulk-issue, reference-commission auto-flow — all explicitly deferred to 2.2/2.3.
