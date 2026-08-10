-- Make hospital_id optional so imported party / direct-patient bills can exist
-- without a hospital. Existing invoices keep their hospital_id; the FK stays
-- (Postgres does not enforce FKs on NULL values).
ALTER TABLE "invoices" ALTER COLUMN "hospital_id" DROP NOT NULL;

-- Free-text party / patient name for imported direct-patient bills that have no
-- hospital. Null for hospital invoices and claim-based direct-patient invoices.
ALTER TABLE "invoices" ADD COLUMN "party_name" TEXT;
