-- Salary: let the admin opt in/out of deducting weekday short hours from pay,
-- per record. Short hours stay tracking-only by default (existing behavior);
-- toggling this on for a record docks the shortfall's rupee value from total pay.
ALTER TABLE "salary_records" ADD COLUMN "short_hours_deducted" BOOLEAN NOT NULL DEFAULT false;
