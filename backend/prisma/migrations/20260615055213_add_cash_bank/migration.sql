-- CreateTable "cash_bank_entries"
CREATE TABLE "cash_bank_entries" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "direction" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "invoice_id" TEXT,
    "expense_id" TEXT,
    "hospital_id" TEXT,
    "utr_number" TEXT NOT NULL DEFAULT '',
    "cheque_number" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_bank_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cash_bank_entries_date_idx" ON "cash_bank_entries"("date" DESC);
CREATE INDEX "cash_bank_entries_direction_mode_date_idx" ON "cash_bank_entries"("direction", "mode", "date" DESC);
CREATE INDEX "cash_bank_entries_invoice_id_idx" ON "cash_bank_entries"("invoice_id");
CREATE INDEX "cash_bank_entries_expense_id_idx" ON "cash_bank_entries"("expense_id");

ALTER TABLE "cash_bank_entries" ADD CONSTRAINT "cash_bank_entries_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cash_bank_entries" ADD CONSTRAINT "cash_bank_entries_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cash_bank_entries" ADD CONSTRAINT "cash_bank_entries_hospital_id_fkey" FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cash_bank_entries" ADD CONSTRAINT "cash_bank_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
