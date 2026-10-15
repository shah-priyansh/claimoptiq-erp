-- Records that a claim's settlement TDS was set manually by the operator, so a
-- deliberate value (including 0) survives the 10% auto-calc and page reload.
-- Mirrors "file_price_overridden". Existing claims keep auto-calculated TDS.
ALTER TABLE "claims" ADD COLUMN "tds_overridden" BOOLEAN NOT NULL DEFAULT false;
