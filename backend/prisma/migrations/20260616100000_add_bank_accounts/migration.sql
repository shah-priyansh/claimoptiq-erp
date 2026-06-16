-- Multi-account bank support. Operator manages a list of bank accounts in
-- Site Settings; one is flagged as default and that one is stamped on the
-- invoice footer + UPI QR. Cash/bank entries gain a foreign key to the
-- specific account so per-account balances stay correct.

CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_holder" TEXT NOT NULL DEFAULT '',
    "account_number" TEXT NOT NULL DEFAULT '',
    "ifsc" TEXT NOT NULL DEFAULT '',
    "upi_id" TEXT NOT NULL DEFAULT '',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bank_accounts_is_default_idx" ON "bank_accounts"("is_default");
CREATE INDEX "bank_accounts_order_idx" ON "bank_accounts"("order");

ALTER TABLE "cash_bank_entries" ADD COLUMN "bank_account_id" TEXT;

CREATE INDEX "cash_bank_entries_bank_account_id_idx" ON "cash_bank_entries"("bank_account_id");

ALTER TABLE "cash_bank_entries"
  ADD CONSTRAINT "cash_bank_entries_bank_account_id_fkey"
  FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed: roll the existing single bank from site_settings into one default
-- BankAccount row. Skip if the operator already has a bank account.
INSERT INTO "bank_accounts" ("id", "bank_name", "account_holder", "account_number", "ifsc", "upi_id", "is_default", "is_active", "order", "updated_at")
SELECT
  gen_random_uuid()::TEXT,
  COALESCE((SELECT value FROM site_settings WHERE key = 'invoice_bank_name'), 'HDFC BANK, NANPURA'),
  COALESCE((SELECT value FROM site_settings WHERE key = 'invoice_bank_account_holder'), 'FIRST CARE CONSULTANCY'),
  COALESCE((SELECT value FROM site_settings WHERE key = 'invoice_bank_account_no'), ''),
  COALESCE((SELECT value FROM site_settings WHERE key = 'invoice_bank_ifsc'), ''),
  COALESCE((SELECT value FROM site_settings WHERE key = 'invoice_upi_id'), ''),
  true,
  true,
  0,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "bank_accounts");
