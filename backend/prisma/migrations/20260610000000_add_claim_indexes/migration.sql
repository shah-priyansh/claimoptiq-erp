-- Indexes to speed up claim list queries.
-- IF NOT EXISTS keeps reruns safe and avoids breaking partial migrations.
CREATE INDEX IF NOT EXISTS "claims_created_at_idx"             ON "claims" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "claims_hospital_id_created_at_idx" ON "claims" ("hospital_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "claims_status_created_at_idx"      ON "claims" ("status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "claims_month_idx"                  ON "claims" ("month");
CREATE INDEX IF NOT EXISTS "claims_ccn_no_idx"                 ON "claims" ("ccn_no");
CREATE INDEX IF NOT EXISTS "claims_patient_name_idx"           ON "claims" ("patient_name");
