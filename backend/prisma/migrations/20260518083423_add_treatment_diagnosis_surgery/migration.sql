-- AlterTable
ALTER TABLE "claims" ADD COLUMN     "diagnosis" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "surgery_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "treatment_type" TEXT NOT NULL DEFAULT '';
