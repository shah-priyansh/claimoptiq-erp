-- Typed Chart-of-Accounts entries for account types not modelled elsewhere:
-- fixed_asset, capital, loan, other. (Bank/Cash/Party/ExpenseCategory are
-- rolled into the Chart of Accounts view but keep their own tables.)
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "account_type" TEXT NOT NULL,
    "group" TEXT NOT NULL DEFAULT 'assets',
    "account_code" TEXT NOT NULL DEFAULT '',
    "parent_id" TEXT,
    "opening_balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "opening_type" TEXT NOT NULL DEFAULT 'debit',
    "as_of_date" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "accounts_account_type_idx" ON "accounts"("account_type");

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
