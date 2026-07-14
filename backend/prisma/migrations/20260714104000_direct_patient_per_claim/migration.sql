-- Direct-patient invoices are per-patient bills — the hospital on them is a
-- pure reference (billing template + display), not a billing target. Each
-- patient's claim gets its own invoice, so the (hospital, month) uniqueness
-- from migration 20260709120000 is wrong for the direct-patient stream and
-- was blocking a legitimate second patient's bill for the same hospital+month.
--
-- Regular (aggregate, per-hospital) invoices still need per-(hospital, month)
-- uniqueness; scope the partial index to those rows only.

DROP INDEX IF EXISTS "invoices_hospital_id_month_is_direct_patient_not_void_key";

CREATE UNIQUE INDEX "invoices_hospital_id_month_regular_not_void_key"
  ON "invoices" ("hospital_id", "month")
  WHERE "status" <> 'void' AND "is_direct_patient" = false;
