-- Hospital rate versions: groups a hospital's HospitalBillingService rows
-- into an effective-dated "rate version". Every hospital gets exactly one
-- "base" version (effective_from_month IS NULL) holding its current rates;
-- future versions let rates change for claims from a given month onward
-- without losing history. The resolver that picks a version is a later task.
--
-- Additive + backfill only:
--   1) create hospital_rate_versions
--   2) seed one base version per existing hospital
--   3) add hospital_billing_services.rate_version_id, backfill to each
--      service's hospital's base version, then enforce NOT NULL + FK.

CREATE TABLE "hospital_rate_versions" (
    "id" TEXT NOT NULL,
    "hospital_id" TEXT NOT NULL,
    "effective_from_month" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hospital_rate_versions_pkey" PRIMARY KEY ("id")
);

-- One row per (hospital, effective month); matches schema.prisma's
-- @@unique([hospitalId, effectiveFromMonth]).
CREATE UNIQUE INDEX "hospital_rate_versions_hospital_id_effective_from_month_key" ON "hospital_rate_versions"("hospital_id", "effective_from_month");

-- Exactly one base version (effective_from_month IS NULL) per hospital.
-- Postgres partial unique index — not representable in schema.prisma, so
-- this is SQL-only and must be kept in sync by hand if the model changes.
CREATE UNIQUE INDEX "hospital_rate_versions_base_key" ON "hospital_rate_versions"("hospital_id") WHERE "effective_from_month" IS NULL;

CREATE INDEX "hospital_rate_versions_hospital_id_idx" ON "hospital_rate_versions"("hospital_id");

ALTER TABLE "hospital_rate_versions" ADD CONSTRAINT "hospital_rate_versions_hospital_id_fkey" FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed exactly one base version per existing hospital.
INSERT INTO "hospital_rate_versions" ("id", "hospital_id", "effective_from_month", "created_at", "updated_at")
SELECT gen_random_uuid(), h."id", NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "hospitals" h;

-- Link every existing billing service to its hospital's base version.
ALTER TABLE "hospital_billing_services" ADD COLUMN "rate_version_id" TEXT;

UPDATE "hospital_billing_services" s
SET "rate_version_id" = v."id"
FROM "hospital_rate_versions" v
WHERE v."hospital_id" = s."hospital_id" AND v."effective_from_month" IS NULL;

ALTER TABLE "hospital_billing_services" ALTER COLUMN "rate_version_id" SET NOT NULL;

CREATE INDEX "hospital_billing_services_rate_version_id_idx" ON "hospital_billing_services"("rate_version_id");

ALTER TABLE "hospital_billing_services" ADD CONSTRAINT "hospital_billing_services_rate_version_id_fkey" FOREIGN KEY ("rate_version_id") REFERENCES "hospital_rate_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
