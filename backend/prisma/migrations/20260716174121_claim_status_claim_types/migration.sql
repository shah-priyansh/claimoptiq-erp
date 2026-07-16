-- AlterTable
ALTER TABLE "claim_statuses" ADD COLUMN "claim_types" JSONB NOT NULL DEFAULT '[]';
