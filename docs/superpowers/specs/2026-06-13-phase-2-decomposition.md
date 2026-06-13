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

| # | Module | What ships | Depends on |
|---|---|---|---|
| **2.1** | **Invoice (FCC Bill)** | Generate monthly invoice per hospital from claims, with TPA Desk slabs + fixed services + GST/TDS + previous-balance roll-forward. Print/PDF. | Existing `HospitalBillingService` + `calculateFilePrice` util |
| **2.2** | **Expense + Reference Commission auto-flow** | Expense CRUD (Salary, Reference Commission, Office, Travel). On invoice generation, auto-insert a "Reference Commission" expense per hospital reference. | 2.1 |
| **2.3** | **Cash/Bank** | Payment IN/OUT ledger linked to Invoice or Expense. Mode = Cash/Bank/UPI. Updates invoice paid status. | 2.1, 2.2 |
| **2.4** | **Accounting (lite)** | General Entry (Dr/Cr/remarks) + Contra (cash↔bank). Not full double-entry — just a manual ledger. | 2.3 (Contra moves cash↔bank balances) |
| **2.5** | **Reports** | Sales (monthly / hospital / service), Expense (category / monthly), Profit = Sales − Expense, Reference (business given vs commission paid), Cash/Bank (balance, In vs Out). | 2.1–2.4 |

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
- `2026-06-13-phase-2-1-invoice-design.md` (this turn)
- `2026-06-XX-phase-2-2-expense-design.md` (next cycle)
- … etc.
