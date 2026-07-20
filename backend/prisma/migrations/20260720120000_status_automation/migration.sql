-- AlterTable
ALTER TABLE "insurance_companies" ADD COLUMN "status_automation" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "tpas" ADD COLUMN "status_automation" JSONB NOT NULL DEFAULT '[]';
