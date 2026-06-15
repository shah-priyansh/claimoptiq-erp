-- CreateTable "tds_rates"
CREATE TABLE "tds_rates" (
    "id" TEXT NOT NULL,
    "tax_name" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "section" TEXT NOT NULL DEFAULT '',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tds_rates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tds_rates_tax_name_idx" ON "tds_rates"("tax_name");

-- AlterTable "invoices" — link to TDS master + snapshot fields
ALTER TABLE "invoices" ADD COLUMN "tds_rate_id" TEXT;
ALTER TABLE "invoices" ADD COLUMN "tds_name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "invoices" ADD COLUMN "tds_section" TEXT NOT NULL DEFAULT '';

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tds_rate_id_fkey" FOREIGN KEY ("tds_rate_id") REFERENCES "tds_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
