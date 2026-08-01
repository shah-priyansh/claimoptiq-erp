-- AlterTable "attendance_records" — approval status for back-dated entries.
-- Existing rows default to 'approved' so historical attendance keeps counting.
ALTER TABLE "attendance_records" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'approved';
