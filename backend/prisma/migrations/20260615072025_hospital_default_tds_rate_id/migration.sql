-- Add the default TDS-rate FK to hospitals so operators can pick a master row
-- instead of typing a raw number. The legacy "tds_rate" float column stays as
-- a fallback for hospitals migrated before the master existed.
ALTER TABLE "hospitals" ADD COLUMN "tds_rate_id" TEXT;
ALTER TABLE "hospitals" ADD CONSTRAINT "hospitals_tds_rate_id_fkey" FOREIGN KEY ("tds_rate_id") REFERENCES "tds_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
