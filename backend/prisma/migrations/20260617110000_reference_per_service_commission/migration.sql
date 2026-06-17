-- Per-applicable-service commission shape. Each row carries its own type
-- ('percentage' | 'fixed' | 'per_claim' | 'one_time') and value. The legacy
-- references.commission_rate column stays for backwards compatibility but is
-- no longer the source of truth — we backfill every existing row with the
-- parent reference's commissionRate as a 'percentage' default so behaviour
-- doesn't change for already-configured references.

ALTER TABLE "reference_applicable_services"
  ADD COLUMN "commission_type" TEXT NOT NULL DEFAULT 'percentage',
  ADD COLUMN "commission_value" DOUBLE PRECISION NOT NULL DEFAULT 0;

UPDATE "reference_applicable_services" ras
SET "commission_value" = COALESCE(r."commission_rate", 0)
FROM "references" r
WHERE ras."reference_id" = r."id";
