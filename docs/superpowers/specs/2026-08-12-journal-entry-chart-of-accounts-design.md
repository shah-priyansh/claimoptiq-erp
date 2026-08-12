# Journal Entry (Double-Entry over the existing Chart of Accounts) — Design

**Date:** 2026-08-12
**Supersedes the UX of:** Phase 2.4 "Account Entry (Light)" — the notes-only General Dr/Cr and the Contra tab.
**Status:** Design for review.

## Goal

Replace the current "Add Account Entry" modal (a floating, notes-only Debit/Credit that connects to nothing) with a real **double-entry Journal Entry**, matching the reference the user provided:

- A header: auto **Reference number** (`JE-51`, `JE-52`…), **Journal Date**, **Description**.
- **2 or more lines**. Each line **selects an account** from the Chart of Accounts and puts an amount in **Debit** or **Credit**.
- Each selected account shows its **current balance** (`Cur Bal: 37,757.52 Dr`).
- **Save is disabled until Σ Debit = Σ Credit.**
- A `+` to add more lines.

Worked example (from the reference): *Owner's Withdrawal Dr 3,90,000 / FIRST CARE CONSULTANCY – HDFC Cr 3,90,000* = the owner withdrew ₹3.9L from the HDFC bank account. After posting, the HDFC balance drops by 3.9L **everywhere it is shown**, and Owner's Withdrawal rises 3.9L Dr.

## Approach: "B — adjusting journal on top of existing balances"

We do **not** rebuild Invoices/Expenses/Cash-Bank as journal postings (that would be Approach A, a full general-ledger rewrite of working modules). Instead:

- Existing modules remain the **source of truth** for their own balances.
- A Journal Entry contributes **double-entry adjusting lines**.
- Every place that shows a balance computes it as **`nativeBalance + Σ(journal.debit − journal.credit)`** for that account.

This is the *same pattern the codebase already uses* to fold `AccountEntry` **contra** amounts into cash/bank balances (`cashBankController.balances`, `accountController.chart`). We are extending that precedent from "contra only" to "any journal line."

### Non-goals (v1)

- No Approach-A general-ledger rewrite.
- **Reports / P&L / Profit integration is deferred (decision (i)).** In v1, journal lines flow into **Chart of Accounts balances** and **Cash/Bank balances** only. The Reports module (Sales/Expense/Profit) continues to read the `invoices`/`expenses` tables directly and is unchanged. Folding expense/party/income journal lines into P&L is a fast-follow (decision (ii)).
- No financial-year lock / period close (unchanged from 2.4).
- No auto-numbering gaps policy beyond "monotonic `JE-n`".

## The account namespace (what "Select A/C" lists)

The picker is the **existing Chart of Accounts**, flattened into selectable rows. Each row carries a stable **polymorphic reference** `{ accountKind, accountId }`:

| Group (as shown) | Source table | `accountKind` | `accountId` | Normal side |
|---|---|---|---|---|
| Bank | each active `BankAccount` | `bank` | `bankAccount.id` | Dr |
| Cash | Cash in Hand (singleton) | `cash` | `null` | Dr |
| Fixed Assets | `Account` (type `fixed_asset`) | `ledger_account` | `account.id` | Dr |
| Capital / Owner's Withdrawal | `Account` (type `capital`) | `ledger_account` | `account.id` | Cr (capital), Dr (drawings) |
| Loans | `Account` (type `loan`) | `ledger_account` | `account.id` | Cr |
| Other | `Account` (type `other`) | `ledger_account` | `account.id` | per `group` |
| Expense heads | each active `ExpenseCategory` | `expense_category` | `category.id` | Dr |
| Sundry Debtors / Creditors | each active `Party` | `party` | `party.id` | Dr (debtor) / Cr (creditor) |

**Refinement vs. today's chart:** the current chart shows Sundry Debtors/Creditors as two **aggregate** lines. For journals we list **individual parties** instead, because a journal adjusts one specific counterparty (e.g. a bad-debt write-off against one customer).

"Owner's Withdrawal", "Owner's Capital", depreciation asset accounts, etc. are **not special-cased** — the user creates them as normal rows on the existing Chart of Accounts (`Account` table) and they appear in the picker automatically.

### New endpoint: `GET /api/accounts/ledger-options`

Returns the flat, grouped, selectable list **with each account's current balance** (so the modal can render `Cur Bal`). Reuses the same aggregation `accountController.chart` already performs, plus per-party balances, plus journal-line folding (see below). Shape:

```json
{
  "groups": [
    { "key": "bank", "label": "Bank Accounts", "accounts": [
      { "kind": "bank", "id": "<uuid>", "name": "FIRST CARE CONSULTANCY - HDFC",
        "code": "50100…", "balance": 37757.52, "side": "Dr" }
    ]},
    { "key": "cash", "label": "Cash", "accounts": [ … ] },
    { "key": "ledger", "label": "Capital / Assets / Loans", "accounts": [ … ] },
    { "key": "expense", "label": "Expense Heads", "accounts": [ … ] },
    { "key": "party", "label": "Sundry Debtors / Creditors", "accounts": [ … ] }
  ]
}
```

`balance` is Dr-signed magnitude; `side` is `"Dr"` when the Dr-signed balance ≥ 0, else `"Cr"`.

## Data model

Two new tables. `AccountEntry` (general + contra) is **left in place** for historical data and keeps feeding balances.

```prisma
model JournalEntry {
  id          String        @id @default(uuid())
  refNumber   String        @unique @map("ref_number")   // "JE-52"
  date        DateTime
  description String        @default("")
  createdById String?       @map("created_by_id")
  createdBy   User?         @relation("JournalEntryCreatedBy", fields: [createdById], references: [id])
  lines       JournalLine[]
  createdAt   DateTime      @default(now()) @map("created_at")
  updatedAt   DateTime      @updatedAt      @map("updated_at")

  @@index([date(sort: Desc)])
  @@map("journal_entries")
}

model JournalLine {
  id          String   @id @default(uuid())
  entryId     String   @map("entry_id")
  entry       JournalEntry @relation(fields: [entryId], references: [id], onDelete: Cascade)

  accountKind String   @map("account_kind")   // 'bank'|'cash'|'ledger_account'|'expense_category'|'party'
  accountId   String?  @map("account_id")      // null only for 'cash'
  accountName String   @map("account_name")    // denormalised label snapshot (audit + display if source renamed/deleted)

  debit       Float    @default(0)
  credit      Float    @default(0)

  createdAt   DateTime @default(now()) @map("created_at")

  @@index([entryId])
  @@index([accountKind, accountId])
  @@map("journal_lines")
}
```

`User` gets a matching `JournalEntry[] @relation("JournalEntryCreatedBy")` back-relation.

## Reference number generation

`JE-<n>` where `n` = (max existing suffix) + 1, starting at 1.

- Computed server-side inside the create transaction: read the current max numeric suffix, format `JE-${n}`.
- `refNumber` is `@unique`; on a concurrent-insert collision (`P2002`) the controller **retries** (recompute + insert) up to a few times. Low volume, single-tenant admin app — this is sufficient and race-safe without `SELECT … FOR UPDATE`.

## Validation (controller)

A journal is valid iff:

1. `date` parses.
2. `lines.length >= 2`.
3. Each line:
   - `accountKind` ∈ the 5 kinds; `accountId` resolves to an existing **active** account of that kind (`accountId` must be `null` iff kind `cash`).
   - `debit >= 0`, `credit >= 0`, and **exactly one** of them is `> 0` (a line is either a debit or a credit, never both, never zero).
   - amounts rounded to **2 decimals** (paise).
4. `abs(Σ debit − Σ credit) < 0.005` (balanced).
5. `accountName` snapshot is taken from the resolved account server-side (client value ignored for trust).

Errors return `{ status: 400, message }` in the existing style.

## Balance computation — where journal lines fold in

One uniform rule everywhere: **Dr-signed balance = nativeBalance(Dr-signed) + Σ(line.debit − line.credit)** over that account's journal lines. Display `Dr` if ≥ 0 else `Cr` (magnitude = abs).

Concretely, extend these existing computations:

1. **`accountController.chart`** — for every group line add its journal contribution:
   - bank line `b`: `+ Σ(dr−cr)` where `kind='bank' AND accountId=b.id`
   - cash line: `+ Σ(dr−cr)` where `kind='cash'`
   - `ledger_account` line `a`: `openingBalance + Σ(dr−cr)` where `kind='ledger_account' AND accountId=a.id`
   - expense line `c`: `expenseTotal + Σ(dr−cr)` where `kind='expense_category' AND accountId=c.id`
   - Sundry Debtors/Creditors: fold per-party `Σ(dr−cr)` into receivable/payable (a Dr to a party ⇒ more receivable; a Cr ⇒ more payable/less receivable).

2. **`cashBankController.balances`** (mode-level cash/bank/upi) — add:
   - `cash += Σ(dr−cr)` for `kind='cash'`
   - `bank += Σ(dr−cr)` for `kind='bank'` (all bank accounts roll into the `bank` mode aggregate; there is no per-bank mode bucket here).
   - Note the mode/account mismatch: the picker's per-account `Cur Bal` uses the **chart-style per-`bankAccount`** number; the mode-level endpoint only needs the `bank` rollup.

3. **`GET /api/accounts/ledger-options`** — same folding, exposed per selectable account so the modal shows `Cur Bal`.

A single reusable helper (e.g. `services/journalBalances.js`) computes `groupBy(accountKind, accountId)` sums of `debit`/`credit` once and is shared by all three call sites, so the folding logic lives in exactly one place.

## API surface

```
GET    /api/journal-entries            ?from&to&q&page&limit   → list (newest first) with lines
GET    /api/journal-entries/:id                                 → one entry with lines
POST   /api/journal-entries                                     → validate + create (assigns JE-n)
PATCH  /api/journal-entries/:id                                 → replace header + lines (re-validate, balances recompute on read)
DELETE /api/journal-entries/:id                                 → cascade-delete lines
GET    /api/accounts/ledger-options                             → grouped selectable accounts + Cur Bal
```

**RBAC:** reuse the existing **`account_entries`** module permissions (same page, same nav slot) — no new RBAC module to seed. `create`/`edit`/`delete`/`view` map straight across.

## UI

**Nav / page:** the existing "Account Entries" page becomes the home for Journal Entries. The **`+ Add Entry`** button opens the new **Journal Entry** modal (the reference screenshot). Existing `AccountEntry` (general/contra) rows remain **visible as legacy history** in the list and keep counting toward balances; the old General/Contra add form is retired (a Contra is expressible as a 2-line journal: Dr bank / Cr cash).

**Journal Entry modal** (`JournalEntryModal.js`):
- Header row: **Reference number** (read-only preview `JE-52`, server-assigned on save), **Journal Date** (defaults today).
- Lines table: `# | ACCOUNT (searchable select, grouped, shows Cur Bal under the name) | CREDIT | DEBIT`.
  - Selecting an account fills the `Cur Bal: … Dr/Cr` sub-label from `ledger-options`.
  - Per line, typing in Debit zeroes Credit and vice-versa.
- Footer totals row: live **Σ Credit** and **Σ Debit**; a red hint when unbalanced.
- `+ Add row` (min 2 rows; rows removable down to 2).
- **Description** textarea.
- **Save** disabled unless balanced and every line has an account + one non-zero amount. (Optional `Save & New` later; not v1.)

**List view:** date, `JE-n`, a compact lines summary (e.g. `Owner's Withdrawal Dr 3,90,000 → HDFC Cr 3,90,000`), description, created-by, edit/delete. Filters: date range + text search (ref/description/account name). Import is **out of scope** for v1 (the old bulk-import stays only for legacy `AccountEntry` if kept, otherwise dropped).

## Edit / delete

- **Edit** replaces the whole line set inside a transaction (delete old lines, insert new), re-running validation. `refNumber` and `date` editable; balances recompute on read (no stored balances), consistent with 2.4.
- **Delete** cascade-removes lines. Allowed even if it makes an account balance go negative/flip side — operator's call, mirrors the existing contra-delete edge case.

## Edge cases

| Case | Behaviour |
|---|---|
| Line with both Debit and Credit > 0 | Rejected (a line is one side only). |
| Only one line, or unbalanced totals | Save blocked client-side; rejected server-side. |
| Selected account later renamed on the Chart of Accounts | Line keeps working via `accountId`; `accountName` snapshot preserves the original label; live views resolve the current name. |
| Selected account later **deleted** | Line falls back to the `accountName` snapshot; its journal contribution still applies to totals but has no live account to attach to (surface as an "unlinked" row; deletion of in-use ledger accounts should ideally be blocked — noted for the Chart of Accounts side). |
| Journal credits a bank account | `bank` mode balance and that bank's per-account balance both drop (folded in both endpoints). |
| Paise amounts (e.g. 37,757.52) | Stored/compared at 2-decimal precision; balance check uses `< 0.005` epsilon. |
| Old `AccountEntry` contra + new journal both moving cash↔bank | Both fold into cash/bank balances additively; no double count (distinct tables). |

## Migration & rollout

1. Prisma migration: create `journal_entries`, `journal_lines`; add `User.journalEntries` back-relation.
2. Add `services/journalBalances.js` helper; wire it into `accountController.chart` and `cashBankController.balances`.
3. Add `accountController.ledgerOptions` + route.
4. Add `journalEntryController` + routes (list/get/create/update/delete) under `account_entries` RBAC.
5. Frontend: `JournalEntryModal.js`, rework `AccountEntryList.js` to list journals (legacy account entries shown read-only), retire the old add modal.
6. No data backfill required — existing `AccountEntry` rows are left as-is and keep folding into balances.

## Testing

- **Unit:** balance folding — a Dr line raises a Dr-normal account, a Cr line lowers it; epsilon balance check; `JE-n` increment + `P2002` retry.
- **Integration:** post the Owner's-Withdrawal example → assert HDFC per-account balance (chart) and `bank` mode balance (cash-bank) both drop by 3.9L, Owner's Withdrawal rises 3.9L Dr; delete the journal → assert full reversal; unbalanced/one-line/both-sides payloads rejected.

## Open questions carried into the plan

- Should deleting a Chart-of-Accounts row that is referenced by a journal line be **blocked** (recommended) vs. allowed-with-fallback? (Leaning: block if referenced.)
- Confirm parties should be listed **individually** in the picker (assumed yes).
