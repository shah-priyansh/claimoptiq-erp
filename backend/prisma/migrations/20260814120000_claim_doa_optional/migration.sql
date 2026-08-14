-- Date of Admission (D.O.A) is now optional. Previously the column was NOT NULL,
-- so a blank D.O.A could not stay blank and was stored as a bogus epoch date
-- (an Excel blank cell arrives as serial 0 → 1899-12-30).
ALTER TABLE "claims" ALTER COLUMN "date_of_admit" DROP NOT NULL;

-- Clear any stranded record whose blank D.O.A was stored as the 1899 epoch
-- (SR 4666 is the only such row at time of writing). Scoped to pre-1970 values
-- so no legitimate admission date is touched.
UPDATE "claims" SET "date_of_admit" = NULL WHERE "date_of_admit" < '1970-01-01';
