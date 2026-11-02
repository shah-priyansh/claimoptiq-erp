-- Admission: Policy Type (Retail / Corporate), with Corporate Name + Employee
-- ID captured only when the policy is corporate. Defaults keep every
-- existing claim reading as "retail" with no backfill needed.
ALTER TABLE "claims" ADD COLUMN "policy_type" TEXT NOT NULL DEFAULT 'retail';
ALTER TABLE "claims" ADD COLUMN "corporate_name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "claims" ADD COLUMN "employee_id" TEXT NOT NULL DEFAULT '';
