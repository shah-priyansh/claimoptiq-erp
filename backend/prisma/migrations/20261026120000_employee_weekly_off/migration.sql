-- Per-employee weekly off day (0 = Sunday … 6 = Saturday).
-- Counted as a paid day in salary and drives the off-day OT premium when worked.
-- Default 0 (Sunday) preserves the previous hard-coded behaviour for every
-- existing employee.
ALTER TABLE "employees" ADD COLUMN "weekly_off" INTEGER NOT NULL DEFAULT 0;
