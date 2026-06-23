-- Allow a fresh invoice for a (hospital, month) when prior ones were voided.
-- Replace the absolute unique index with a partial unique index that ignores
-- voided rows so the slot becomes available again after a void.
DROP INDEX IF EXISTS "invoices_hospital_id_month_key";

CREATE UNIQUE INDEX "invoices_hospital_id_month_not_void_key"
  ON "invoices" ("hospital_id", "month")
  WHERE "status" <> 'void';
