# Phase 2.4 — Account Entry (Light) Design

## Goal

Minimal manual ledger for two entry types:
1. **General Entry** — free Debit / Credit / Remarks. Operator records anything that doesn't fit Invoice/Expense/Cash-Bank (opening balances, adjustments, year-end notes).
2. **Contra Entry** — moves cash ↔ bank. One transaction, two sides: amount leaves one bucket and enters the other.

Explicit non-goal in the brief: **no full double-entry accounting.** This is a notes-with-numbers system, not a chart of accounts.

## Why this exists separately from Cash/Bank

- 2.3 Cash/Bank tracks money entering or leaving FCC. Contra is *internal* movement (withdraw cash from bank, or deposit cash to bank) — neither IN nor OUT relative to FCC.
- The Reports Cash/Bank balances (2.6) read both 2.3 entries (signed by direction) and 2.4 contras (signed by side) to compute per-mode balance.

## Data model

```prisma
model AccountEntry {
  id          String   @id @default(uuid())
  date        DateTime
  entryType   String   @map("entry_type")             // 'general' | 'contra'
  remarks     String   @default("")

  // General entry fields (entryType='general')
  debit       Float    @default(0)
  credit      Float    @default(0)

  // Contra entry fields (entryType='contra')
  fromMode    String?  @map("from_mode")              // 'cash' | 'bank' | 'upi'
  toMode      String?  @map("to_mode")                // 'cash' | 'bank' | 'upi'
  amount      Float    @default(0)                    // contra amount; 0 for general

  createdById String?  @map("created_by_id")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  createdBy   User?    @relation("AccountEntryCreatedBy", fields: [createdById], references: [id])

  @@index([date(sort: Desc)])
  @@index([entryType, date(sort: Desc)])
  @@map("account_entries")
}
```

**Why one table, not two?** The fields don't overlap meaningfully and the volume is low. One table + `entryType` discriminator keeps the list view trivial. Controller validates field combinations per type.

### Validation (controller, not schema)

- `entryType='general'`: at least one of `debit`/`credit` > 0; `amount`, `fromMode`, `toMode` must be 0/null.
- `entryType='contra'`: `amount` > 0; `fromMode` and `toMode` both set and not equal; `debit`/`credit` must be 0.

## Cash/Bank balance contribution

The balance calculation lives in 2.3's `/api/cash-bank/balances` endpoint. To include contras:

```text
balance(mode) =
  Σ CashBankEntry.amount where mode=this AND direction='in'
− Σ CashBankEntry.amount where mode=this AND direction='out'
+ Σ AccountEntry.amount where entryType='contra' AND toMode=this
− Σ AccountEntry.amount where entryType='contra' AND fromMode=this
```

General entries do not affect cash/bank balances. They are notes-only.

## API surface

```
GET    /api/account-entries           ?from&to&entryType&q
POST   /api/account-entries           → validates per type, then inserts
PATCH  /api/account-entries/:id       → same validation; cash/bank balances recompute on read
DELETE /api/account-entries/:id
GET    /api/account-entries/summary   ?from&to → { generalDebit, generalCredit, contraCount }
```

RBAC module name: `account_entries`. Standard perms.

## UI surface

```
/account-entries              — list with type filter, date range; two columns for Dr/Cr or "→ Contra: ₹X Cash→Bank"
/account-entries/new          — tabbed form: [General] [Contra]
                                General: date, Dr, Cr, remarks
                                Contra:  date, from mode, to mode, amount, remarks
/account-entries/:id/edit     — same
```

The Cash/Bank balances strip (already on `/cash-bank`) now reflects contras automatically because balance math reads both tables.

## Edge cases

| Case | Behaviour |
|---|---|
| Operator deletes a contra that funded a downstream payment | Allowed. The cash bucket can go negative (UI shows red). Operator's problem to reconcile. |
| Same `fromMode` and `toMode` on contra | Rejected. |
| General entry with both debit and credit > 0 | Allowed (split adjustment). Net = credit − debit for reporting (not surfaced in MVP). |
| Contra with `mode='upi'` | Allowed. UPI is a tracked bucket so contras between Cash/Bank/UPI all work. |
| Editing a contra after balances were used downstream | Balances recompute on every read. No locking. |

## Testing

- **Unit:** balance contribution math — contra increments `toMode`, decrements `fromMode`.
- **Integration:** post general + contra, fetch `/cash-bank/balances`, assert math is right; delete contra, assert reversal.

## Migration & rollout

1. Prisma migration: create `account_entries`.
2. RBAC: `account_entries` module added.
3. Update `/api/cash-bank/balances` to include AccountEntry contras in the math.

## What 2.4 does NOT include

- Chart of accounts, ledger codes, journal types beyond the two named.
- Trial balance / P&L generation.
- Locking past entries by a financial-year close.
