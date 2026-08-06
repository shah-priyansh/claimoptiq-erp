-- AlterTable "invoices" — add operator-chosen invoice date
ALTER TABLE "invoices" ADD COLUMN "invoice_date" TIMESTAMP(3);
