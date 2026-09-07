-- Salary: track weekday short hours (shortfall below the standard duty) on the
-- monthly salary snapshot, alongside the existing OT-minute columns. Informational
-- only — never auto-deducted from pay; the admin decides whether to offset it.
ALTER TABLE "salary_records" ADD COLUMN "short_minutes" INTEGER NOT NULL DEFAULT 0;
