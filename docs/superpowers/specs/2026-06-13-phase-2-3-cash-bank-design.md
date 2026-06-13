# Phase 2.3 — Cash / Bank Module Design

## Goal

A movement-tracker (not an accounting ledger) for money flowing IN to FCC (from hospitals settling invoices) and OUT of FCC (paying expenses / commissions). Each row records: when, in/out, how much, by what mode (Cash / Bank / UPI), and what it relates to (Invoice or Expense).

Running balances by mode fall out of this ledger and feed the Cash/Bank report (2.6).

## Non-goals

- Bank reconciliation (importing bank statements, matching).
- Multi-currency.
- Multiple bank accounts. **Decision:** one logical "Bank" bucket + one "Cash" bucket + one "UPI" bucket. If the operator needs per-account breakdown later, we add an `account` master without changing this ledger shape.
- Double-entry. Contra moves (cash↔bank) are recorded in 2.4 Account Entry, not here.

## Data model

```prisma
model CashBankEntry {
  id            String   @id @default(uuid())
  date          DateTime
  direction     String                                        // 'in' | 'out'
  mode          String                                        // 'cash' | 'bank' | 'upi'
  amount        Float                                          // always positive; direction tells the sign
  notes         String   @default("")

  // What this payment relates to. At most one of these may be set (enforced in service layer).
  // Both null is allowed for miscellaneous receipts/payouts (see edge cases).
  invoiceId     String?  @map("invoice_id")                    // direction='in'  → settles an invoice
  expenseId     String?  @map("expense_id")                    // direction='out' → pays an expense
  hospitalId    String?  @map("hospital_id")                   // denormalized for fast "by hospital" reports

  // Optional extras
  utrNumber     String   @default("") @map("utr_number")       // for bank/UPI
  chequeNumber  String   @default("") @map("cheque_number")    // for cash/cheque

  createdById   String?  @map("created_by_id")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  invoice       Invoice?  @relation(fields: [invoiceId], references: [id])
  expense       Expense?  @relation(fields: [expenseId], references: [id])
  hospital      Hospital? @relation(fields: [hospitalId], references: [id])
  createdBy     User?     @relation("CashBankCreatedBy", fields: [createdById], references: [id])

  @@index([date(sort: Desc)])
  @@index([direction, mode, date(sort: Desc)])
  @@index([invoiceId])
  @@index([expenseId])
  @@map("cash_bank_entries")
}
```

### Invoice / Expense back-relations

Add `payments CashBankEntry[]` to `Invoice` and `Expense` (named relations as above).

### Invoice paid-amount denormalization

When a Cash/Bank entry is created/updated/deleted against an invoice, the invoice's `amountPaid` / `amountPending` / `status` (`issued` → `partially_paid` → `paid`) are recomputed in the same transaction.

```text
amountPaid = Σ entries where invoiceId=this AND direction='in'
amountPending = grandTotal − amountPaid
status =
  amountPaid >= grandTotal          → 'paid'
  amountPaid > 0                    → 'partially_paid'
  otherwise                         → 'issued'      (cannot go back to 'draft')
```

Overpayment (amountPaid > grandTotal): allowed, status stays `paid`. The excess shows as a credit on next invoice's `previousBalance` (it goes negative). Operator can apply manual adjustment line in the next invoice draft to zero it.

## API surface

```
GET    /api/cash-bank                       ?from&to&direction&mode&hospitalId&invoiceId&expenseId&q
POST   /api/cash-bank                       → create + recompute invoice/expense rollups
PATCH  /api/cash-bank/:id                   → update + recompute
DELETE /api/cash-bank/:id                   → delete + recompute (with guardrails)
GET    /api/cash-bank/balances              → { cash, bank, upi, total } current
GET    /api/cash-bank/summary               ?from&to → { in, out, net } by mode (Reports 2.6)
```

**Payment-against-invoice convenience endpoint:**

```
POST   /api/invoices/:id/payments           { date, mode, amount, utrNumber?, chequeNumber?, notes? }
```

Same effect as creating a CashBankEntry with `invoiceId` set; just a friendlier UX for the invoice detail page.

RBAC module name: `cash_bank`. Standard perms. Edit/delete of a row that's already triggered a status flip (e.g. invoice now `paid`) is allowed but logged.

## UI surface

```
/cash-bank              — ledger list: filters by direction/mode/date/hospital; balances strip on top
/cash-bank/new          — form: date, in/out, mode, amount, link to invoice OR expense, UTR/cheque, notes
/cash-bank/:id/edit     — same
/invoices/:id           — adds a "Record Payment" panel (uses the convenience endpoint)
/expenses/:id           — adds a "Mark Paid" panel (creates direction='out' entry)
```

Balances strip on `/cash-bank`: three tiles (Cash / Bank / UPI) showing current running total + small "today's net" line.

## Edge cases

| Case | Behaviour |
|---|---|
| Both `invoiceId` and `expenseId` set on same row | Rejected with 400. At-most-one rule enforced in controller. |
| Row deleted that paid an invoice in full | Invoice rolled back to `partially_paid` or `issued`. |
| Invoice voided after a payment was recorded | Disallowed at the invoice layer (see 2.1 void rules). Operator must reverse the payment first (create direction='out' offset row, or delete the IN row). |
| Negative `amount` | Rejected. Reversal is done by deleting the row or adding an opposite-direction row, not signed amounts. |
| `direction='in'` without `invoiceId` | Allowed (e.g. miscellaneous receipt). `hospitalId` optional. Reports bucket as "Other". |
| `direction='out'` without `expenseId` | Allowed (e.g. petty cash payout). Reports bucket as "Other". |
| Mode `upi` with `chequeNumber` | Allowed but UI hides the field; backend doesn't validate exclusivity. |
| Concurrent payments updating same invoice | Wrap recompute in `prisma.$transaction` with `SERIALIZABLE` or use a row-level lock via `SELECT … FOR UPDATE` raw query. |

## Testing

- **Unit:** invoice rollup function — paid/partially_paid/paid transitions, overpayment, deletion rollback.
- **Integration:** record full payment via convenience endpoint, assert invoice goes `paid`. Delete payment, assert rollback. Two partial payments → `partially_paid` → `paid`.
- **Manual:** balances strip updates on entry create.

## Migration & rollout

1. Prisma migration: create `cash_bank_entries`, add back-relations to `Invoice` and `Expense`.
2. RBAC: `cash_bank` module added.
3. No backfill (no prior payment data).

## What 2.3 does NOT include

- Contra entries (cash ↔ bank movement) — handled by 2.4 Account Entry.
- Bank reconciliation / statement import.
- Vendor/payee master separate from Reference.
- Profit calculation (2.6).
