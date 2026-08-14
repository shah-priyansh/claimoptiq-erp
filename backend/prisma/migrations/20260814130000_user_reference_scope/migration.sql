-- Reference-scoped login: a user can be tied to a Reference so they only see
-- data for the hospitals belonging to that reference (mirrors hospital_id).
ALTER TABLE "users" ADD COLUMN "reference_id" TEXT;

CREATE INDEX "users_reference_id_idx" ON "users"("reference_id");

ALTER TABLE "users" ADD CONSTRAINT "users_reference_id_fkey" FOREIGN KEY ("reference_id") REFERENCES "references"("id") ON DELETE SET NULL ON UPDATE CASCADE;
