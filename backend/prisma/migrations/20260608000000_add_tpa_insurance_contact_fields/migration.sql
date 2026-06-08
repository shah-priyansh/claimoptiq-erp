-- AlterTable: add address & contact fields to insurance_companies
ALTER TABLE "insurance_companies"
  ADD COLUMN "address" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "contact_person" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "mobile" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "email" TEXT NOT NULL DEFAULT '';

-- AlterTable: add address & contact fields to tpas
ALTER TABLE "tpas"
  ADD COLUMN "address" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "contact_person" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "mobile" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "email" TEXT NOT NULL DEFAULT '';
