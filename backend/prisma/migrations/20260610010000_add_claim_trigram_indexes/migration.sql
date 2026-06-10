-- Enable the trigram extension (idempotent if already installed).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram indexes accelerate the ILIKE '%query%' search OR used by
-- getClaims (patient_name, ccn_no, policy_no, client_id). Btree indexes on
-- these columns only help equality / prefix matches, not substring search.
CREATE INDEX IF NOT EXISTS "claims_patient_name_trgm_idx" ON "claims" USING gin ("patient_name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "claims_ccn_no_trgm_idx"       ON "claims" USING gin ("ccn_no"       gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "claims_policy_no_trgm_idx"    ON "claims" USING gin ("policy_no"    gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "claims_client_id_trgm_idx"    ON "claims" USING gin ("client_id"    gin_trgm_ops);
