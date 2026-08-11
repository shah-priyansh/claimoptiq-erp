-- Accounting nature for expense categories: 'expense' (P&L) | 'capital' |
-- 'fixed_asset'. Capital / fixed-asset categories are excluded from P&L reports.
ALTER TABLE "expense_categories" ADD COLUMN "nature" TEXT NOT NULL DEFAULT 'expense';
