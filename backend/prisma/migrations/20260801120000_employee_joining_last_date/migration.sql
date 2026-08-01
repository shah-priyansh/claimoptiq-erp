-- AlterTable "employees" — add employment window dates
ALTER TABLE "employees" ADD COLUMN "joining_date" TIMESTAMP(3);
ALTER TABLE "employees" ADD COLUMN "last_date" TIMESTAMP(3);
