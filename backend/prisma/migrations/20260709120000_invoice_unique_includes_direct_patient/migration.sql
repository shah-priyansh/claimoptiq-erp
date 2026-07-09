-- Direct-patient invoices bill against a target hospital as a separate stream
-- from that hospital's regular claim-based invoices (see migration
-- 20260624120000_invoice_direct_patient). The application already treats them
-- as separate slots per (hospital, month), but the earlier partial-unique
-- index didn't include is_direct_patient, so creating a direct-patient
-- invoice for a hospital+month that already had a regular invoice (or vice
-- versa) failed at the DB layer even though the app pre-check said it was
-- fine. Extend the partial-unique index to include is_direct_patient so both
-- streams can coexist.
DROP INDEX IF EXISTS "invoices_hospital_id_month_not_void_key";

CREATE UNIQUE INDEX "invoices_hospital_id_month_is_direct_patient_not_void_key"
  ON "invoices" ("hospital_id", "month", "is_direct_patient")
  WHERE "status" <> 'void';
