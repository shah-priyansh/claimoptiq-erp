-- "Claim Process By" — a free-text, self-learning field on a claim recording
-- who processed/handled it. Previously-entered values are surfaced as dropdown
-- suggestions on the form and as a list filter. NOT NULL with a '' default so
-- existing rows read back as blank rather than NULL.
ALTER TABLE "claims" ADD COLUMN "claim_process_by" TEXT NOT NULL DEFAULT '';
