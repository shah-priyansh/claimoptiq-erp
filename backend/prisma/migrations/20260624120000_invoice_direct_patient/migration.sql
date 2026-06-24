-- Mark invoices that bill direct-patient claims against a chosen hospital so
-- reports can keep direct-patient revenue separate from a hospital's regular
-- claim-based invoices. The hospital_id column still points to the chosen
-- target hospital so existing per-hospital listings continue to work.
ALTER TABLE "invoices" ADD COLUMN "is_direct_patient" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "invoices_is_direct_patient_idx" ON "invoices" ("is_direct_patient");
