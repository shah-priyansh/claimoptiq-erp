# Phase 2 — Decomposition & Sequencing

**Scope as given:** FCC Bill Generation, Expense Module, Cash/Bank Module, simple Accounting, Reference Commission Auto Flow, Reports.

**Verdict:** Too large for a single spec. Decompose into 5 sub-projects. Each gets its own design → plan → implementation cycle.

## Why these boundaries

The modules form a dependency tree:

```
Invoice (2.1) ──┬─► Reference Commission (auto-creates Expense)
                ├─► Cash/Bank Payment IN (settles Invoice)
                └─► Reports (Sales)

Expense (2.2) ──┬─► Cash/Bank Payment OUT
                └─► Reports (Expense, Profit)

Cash/Bank (2.3) ──► Accounting (Contra moves cash↔bank)
                └─► Reports (Balance, In/Out)

Accounting (2.4) ──► Reports

Reports (2.5)
```

Invoice must come first — it is the trigger for Reference Commission, the receivable that Cash/Bank settles, and the data source for Sales reports. Reports come last because they aggregate everything.

## Sub-project sequence

Numbering aligns with the brief's modules 1–7 (5 designs because 5 is not its own module in the brief, only a Contra/General light ledger; the brief's #6 commission flow is split into its own design since it's its own behaviour).

| Spec # | Brief # | Module | What ships | Depends on |
|---|---|---|---|---|
| **2.0** | 1 | **Reference Master** | Promote `Hospital.referenceBy` from free string to a FK on a `Reference` master with name/mobile/address/commission %/applicable services (multi-select). | — |
| **2.1** | 2 | **Invoice (FCC Bill)** | Generate monthly invoice per hospital from claims, with TPA Desk slabs + fixed services + GST/TDS + previous-balance roll-forward. Print/PDF. | 2.0, existing `HospitalBillingService` + `calculateFilePrice` util |
| **2.2** | 3 | **Expense** | Manual CRUD for four categories (Salary, Reference Commission, Office, Travel). Fields: date, category, amount, notes, optional reference. Auto-created rows are protected from edit/delete. | — (independent of 2.0/2.1 for the CRUD; consumed by 2.5) |
| **2.3** | 4 | **Cash/Bank** | Payment IN/OUT ledger linked to Invoice or Expense. Mode = Cash / Bank / UPI. Recomputes invoice `amountPaid` / `status` on every change. | 2.1, 2.2 |
| **2.4** | 5 | **Account Entry (Light)** | General Entry (Dr/Cr/remarks) + Contra (cash ↔ bank/UPI). Not full double-entry. Contras feed cash/bank balance math. | 2.3 |
| **2.5** | 6 | **Reference Commission Auto Flow** | On invoice issue: walk line items → match hospital→reference→applicable services → write Expense rows (category=Reference Commission). Idempotent via `(sourceType, sourceLineId)` unique index. Undone on void. | 2.0, 2.1, 2.2 |
| **2.6** | 7 | **Reports** | Sales (monthly / hospital / service), Expense (category / monthly), Profit = Sales − Expense, Reference (business given vs commission paid), Cash/Bank (balances, In vs Out). | 2.1–2.5 |

## Out-of-scope clarifications (made without asking)

- **Month-attribution rule for claims → invoice:** Use `dateOfDischarge` falling within the invoice month. Reasons:
  - Admit-based would split multi-month stays inconsistently.
  - Submission-based depends on FCC's internal workflow timing, which slips.
  - Discharge is the natural "service-rendered" date and is what TPA Desk slabs price against.
  - Claims without a discharge date are not yet billable.
- **`isBilled` flag (already on Claim):** flipped to `true` when included in an issued invoice. Prevents double-billing.
- **`filePrice` (already on Claim):** kept as the snapshot of TPA Desk fee at invoice time. If `filePriceOverridden` is set, the override wins.
- **GST/TDS rates:** stored on `Hospital` (new fields `gstRate`, `tdsRate`), not on each service. Most hospitals will have one rate.
- **Invoice number format:** `FCC/YYYY-YY/NNNN` (financial-year + running sequence), per Indian invoicing convention.
- **No full double-entry accounting.** The 2.4 module is a manual ledger only, as the spec implies ("Keep it SIMPLE").

## What this document is not

This is the decomposition + cross-cutting decisions. Each sub-project has its own design doc:
- `2026-06-13-phase-2-0-reference-master-design.md`
- `2026-06-13-phase-2-1-invoice-design.md`
- `2026-06-13-phase-2-2-expense-design.md`
- `2026-06-13-phase-2-3-cash-bank-design.md`
- `2026-06-13-phase-2-4-account-entry-design.md`
- `2026-06-13-phase-2-5-commission-auto-flow-design.md`
- `2026-06-13-phase-2-6-reports-design.md`
