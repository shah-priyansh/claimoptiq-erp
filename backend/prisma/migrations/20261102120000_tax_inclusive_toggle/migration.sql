-- "With tax / without tax" entry-mode toggle for invoices and expenses.
-- When true, the entered amount is treated as GST-inclusive (GST is backed
-- out of it) instead of GST being added on top. Net payable / grand total is
-- unchanged either way — only the gross/GST split differs. Defaults false so
-- every existing row keeps its current math.
ALTER TABLE "invoices" ADD COLUMN "tax_inclusive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "expenses" ADD COLUMN "tax_inclusive" BOOLEAN NOT NULL DEFAULT false;
