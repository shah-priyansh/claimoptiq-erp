-- Undo 20260709103000_hospital_direct_patient_template: the template
-- concept was replaced by a dedicated DirectPatientBillingService model
-- (added in the next migration) since the client wants a global setting,
-- not a hospital record acting as a template.
DROP INDEX IF EXISTS "hospitals_direct_patient_template_unique";
ALTER TABLE "hospitals" DROP COLUMN IF EXISTS "is_direct_patient_template";
