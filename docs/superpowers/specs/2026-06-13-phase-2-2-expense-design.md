# Phase 2.2 — Expense Module Design

## Goal

Flat expense ledger that tracks money going out of FCC under four categories: Salary, Reference Commission, Office Expense, Travel. Manual CRUD for all; Reference Commission rows are *also* written automatically by 2.5 (commission engine) — but the table accepts manual entries in that category too (correction rows, edge cases).

## Non-goals

- Approval workflows, multi-step authorization, attachment-required policies.
- Tax / TDS on expenses (out of scope; categories are bookkeeping, not tax buckets).
- Tight integration with Salary module — the existing `SalaryRecord` model already exists, but 2.2 stays decoupled. Linking is optional via `sourceType`/`sourceId`.

## Data model

```prisma
model ExpenseCategory {
  id        String   @id @default(uuid())
  slug      String   @unique                                  // 'salary' | 'reference_commission' | 'office' | 'travel'
  label     String                                              // 'Salary', 'Reference Commission', ...
  isSystem  Boolean  @default(false) @map("is_system")          // seeded four cannot be deleted
  isActive  Boolean  @default(true) @map("is_active")
  order     Int      @default(0)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  expenses  Expense[]

  @@map("expense_categories")
}

model Expense {
  id            String   @id @default(uuid())
  date          DateTime                                      // user-entered expense date
  categoryId    String   @map("category_id")
  amount        Float
  notes         String   @default("")
  referenceId   String?  @map("reference_id")                 // optional link to a Reference master row (any category)

  // Provenance — only set when row was auto-created (commission engine, future automations)
  sourceType    String?  @map("source_type")                  // 'invoice_commission' | null
  sourceId      String?  @map("source_id")                    // Invoice.id (for sourceType='invoice_commission')
  sourceLineId  String?  @map("source_line_id")               // InvoiceLineItem.id, so re-runs are idempotent

  createdById   String?  @map("created_by_id")
  updatedById   String?  @map("updated_by_id")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  category      ExpenseCategory @relation(fields: [categoryId], references: [id])
  reference     Reference?      @relation(fields: [referenceId], references: [id])
  createdBy     User?           @relation("ExpenseCreatedBy", fields: [createdById], references: [id])
  updatedBy     User?           @relation("ExpenseUpdatedBy", fields: [updatedById], references: [id])

  @@index([date(sort: Desc)])
  @@index([categoryId, date(sort: Desc)])
  @@index([referenceId])
  @@unique([sourceType, sourceLineId])                        // idempotency for auto-flow
  @@map("expenses")
}
```

`sourceLineId` is unique-per-`sourceType` so 2.5's commission engine can safely reissue an invoice (rare) without double-writing the same commission expense.

## API surface

```
GET    /api/expense-categories                → list (system + custom)
POST   /api/expense-categories                → create (non-system only)
PATCH  /api/expense-categories/:id            → rename / reorder / activate
DELETE /api/expense-categories/:id            → block if isSystem or has expenses

GET    /api/expenses                          ?categoryId&referenceId&from&to&q → paginated list
GET    /api/expenses/:id                      → detail
POST   /api/expenses                          → create
PATCH  /api/expenses/:id                      → update
DELETE /api/expenses/:id                      → delete (with a guard on auto-created rows; see below)
GET    /api/expenses/summary                  ?from&to → totals by category (used by Reports 2.6)
```

**Auto-created row protection:** rows where `sourceType IS NOT NULL` cannot be edited or deleted via the standard endpoints. The 2.5 engine owns them. Operator can leave a manual offset row to correct (e.g. negative Reference Commission entry with notes "manual reversal — invoice voided").

RBAC module name: `expenses`. Standard view/create/edit/delete/export. `expense_categories` is super-admin-only.

## UI surface

```
/expenses                    — list with category chips, date range, reference filter, totals strip
/expenses/new                — form: date, category, amount, notes, optional reference dropdown
/expenses/:id/edit           — same, blocked for sourceType!=null
/settings/expense-categories — super-admin CRUD
```

Reference dropdown shows the same Reference list as Hospital form (active only). Auto-flow rows in the list get a small "Auto" badge with a tooltip linking back to the source invoice.

## Edge cases

| Case | Behaviour |
|---|---|
| User picks "Reference Commission" category but no reference | Allowed (manual reconciliation), but UI warns. Reports treat as "Reference Commission — unattributed". |
| Invoice voided that already auto-created commission rows | 2.5 handles deletion of the auto rows in the same transaction as void. 2.2 just must allow `DELETE` for rows the engine owns. Resolution: engine deletes by `(sourceType, sourceId)`. |
| Category renamed (`label`) | Existing rows continue rendering with the new label (FK by id). No backfill needed. |
| Category soft-deleted | Hidden from new-expense category picker but still rendered for historical rows. |
| Bulk salary expense at month-end | Out of scope for 2.2 — operator enters one row per employee or one aggregate row. Future enhancement could push from `SalaryRecord`. |
| Negative amount | Allowed (reversals/refunds). Reports sum signed. |

## Migration & rollout

1. Prisma migration: create `expense_categories`, `expenses`.
2. Seed: insert the four system categories (`salary`, `reference_commission`, `office`, `travel`) with `isSystem=true`.
3. RBAC: `expenses` module added; default `view/create/edit/delete` for super_admin + admin.

## Testing

- **Integration:** create expense in each category, with and without reference; list filters work; auto-row protection blocks edit/delete via standard endpoint.
- **Manual:** category settings page guards deletion of system rows.

## What 2.2 does NOT include

- Auto-creation of Reference Commission rows (2.5)
- Cash-out movement (2.3 Cash/Bank — paying an expense)
- Profit calculation (2.6 Reports)
