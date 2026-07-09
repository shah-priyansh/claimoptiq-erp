ALTER TABLE "hospitals" ADD COLUMN "is_direct_patient_template" BOOLEAN NOT NULL DEFAULT false;

-- At most one hospital can be the direct-patient template. Partial unique
-- index sidesteps the trivially-true "false" values while enforcing
-- uniqueness on the single true row.
CREATE UNIQUE INDEX "hospitals_direct_patient_template_unique"
  ON "hospitals" (is_direct_patient_template)
  WHERE is_direct_patient_template = true;
