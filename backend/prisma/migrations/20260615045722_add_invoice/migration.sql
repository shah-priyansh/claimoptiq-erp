-- AlterTable "hospitals" — add invoice fields
ALTER TABLE "hospitals" ADD COLUMN "gst_rate" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "hospitals" ADD COLUMN "tds_rate" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "hospitals" ADD COLUMN "invoice_prefix" TEXT NOT NULL DEFAULT 'FCC';

-- CreateTable "invoices"
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "invoice_number" TEXT,
    "hospital_id" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "issued_at" TIMESTAMP(3),
    "due_date" TIMESTAMP(3),
    "subtotal_tpa_desk" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subtotal_services" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subtotal_adjustments" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gross" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gst_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gst_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tds_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tds_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "net_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "previous_balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grand_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount_paid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount_pending" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT,
    "issued_by_id" TEXT,
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable "invoice_line_items"
CREATE TABLE "invoice_line_items" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "line_type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL DEFAULT 0,
    "claim_id" TEXT,
    "billing_service_id" TEXT,
    "billing_service_name_id" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");
CREATE UNIQUE INDEX "invoices_hospital_id_month_key" ON "invoices"("hospital_id", "month");
CREATE INDEX "invoices_status_idx" ON "invoices"("status");
CREATE INDEX "invoices_month_idx" ON "invoices"("month");
CREATE INDEX "invoice_line_items_invoice_id_idx" ON "invoice_line_items"("invoice_id");

-- Foreign keys
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_hospital_id_fkey" FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
