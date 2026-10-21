-- Add QTY/RATE line math to invoice line items, and give expenses an
-- invoice-style itemization (new expense_line_items table). Mirrors the
-- HospitalFinalBillItem shape (rate, qty_raw, qty_is_percent, qty_value, amount);
-- see utils/lineQty.js. Both backfills preserve every existing amount exactly.

-- 1) Invoice line items: add qty/rate columns.
ALTER TABLE "invoice_line_items"
  ADD COLUMN "rate"           DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "qty_raw"        TEXT             NOT NULL DEFAULT '1',
  ADD COLUMN "qty_is_percent" BOOLEAN          NOT NULL DEFAULT false,
  ADD COLUMN "qty_value"      DOUBLE PRECISION NOT NULL DEFAULT 1;

-- Backfill: treat every existing line as rate x 1 so amount = rate stays identical.
UPDATE "invoice_line_items" SET "rate" = "amount";

-- 2) Expense line items: new table.
CREATE TABLE "expense_line_items" (
  "id"             TEXT NOT NULL,
  "expense_id"     TEXT NOT NULL,
  "description"    TEXT NOT NULL DEFAULT '',
  "rate"           DOUBLE PRECISION NOT NULL DEFAULT 0,
  "qty_raw"        TEXT NOT NULL DEFAULT '1',
  "qty_is_percent" BOOLEAN NOT NULL DEFAULT false,
  "qty_value"      DOUBLE PRECISION NOT NULL DEFAULT 1,
  "amount"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "order"          INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "expense_line_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "expense_line_items_expense_id_idx" ON "expense_line_items" ("expense_id");

ALTER TABLE "expense_line_items" ADD CONSTRAINT "expense_line_items_expense_id_fkey"
  FOREIGN KEY ("expense_id") REFERENCES "expenses" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one line per existing expense (description = notes, else category
-- label, else "Expense"; rate = amount, qty = 1) so expense.amount stays the sum
-- of its lines and the new form shows the amount as a single editable line.
INSERT INTO "expense_line_items"
  ("id", "expense_id", "description", "rate", "qty_raw", "qty_is_percent", "qty_value", "amount", "order")
SELECT
  gen_random_uuid()::text,
  e."id",
  COALESCE(NULLIF(e."notes", ''), c."label", 'Expense'),
  e."amount",
  '1', false, 1,
  e."amount",
  0
FROM "expenses" e
LEFT JOIN "expense_categories" c ON c."id" = e."category_id";
