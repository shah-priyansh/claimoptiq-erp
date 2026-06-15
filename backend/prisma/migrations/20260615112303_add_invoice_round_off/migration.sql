-- Manual round-off applied by the operator on a draft invoice, e.g. to
-- nudge the grand total to a clean number. Persisted so the issued PDF
-- stays consistent across re-renders.
ALTER TABLE "invoices" ADD COLUMN "round_off" DOUBLE PRECISION NOT NULL DEFAULT 0;
