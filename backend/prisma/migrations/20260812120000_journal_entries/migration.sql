-- Double-entry Journal Entry over the existing Chart of Accounts. Each entry
-- holds >=2 balanced lines; each line points polymorphically at an account
-- (bank / cash / ledger_account / expense_category / party) via account_kind +
-- account_id, and carries a denormalised account_name snapshot.
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "ref_number" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "account_kind" TEXT NOT NULL,
    "account_id" TEXT,
    "account_name" TEXT NOT NULL,
    "debit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "credit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "journal_entries_ref_number_key" ON "journal_entries"("ref_number");
CREATE INDEX "journal_entries_date_idx" ON "journal_entries"("date" DESC);
CREATE INDEX "journal_lines_entry_id_idx" ON "journal_lines"("entry_id");
CREATE INDEX "journal_lines_account_kind_account_id_idx" ON "journal_lines"("account_kind", "account_id");

ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
