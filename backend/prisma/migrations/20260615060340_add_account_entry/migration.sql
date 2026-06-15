-- CreateTable "account_entries"
CREATE TABLE "account_entries" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "entry_type" TEXT NOT NULL,
    "remarks" TEXT NOT NULL DEFAULT '',
    "debit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "credit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "from_mode" TEXT,
    "to_mode" TEXT,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "account_entries_date_idx" ON "account_entries"("date" DESC);
CREATE INDEX "account_entries_entry_type_date_idx" ON "account_entries"("entry_type", "date" DESC);

ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
