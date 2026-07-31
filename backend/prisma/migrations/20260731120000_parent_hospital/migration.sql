-- AlterTable "hospitals" — optional one-level branch hierarchy (self relation)
ALTER TABLE "hospitals" ADD COLUMN "parent_hospital_id" TEXT;

-- CreateIndex
CREATE INDEX "hospitals_parent_hospital_id_idx" ON "hospitals"("parent_hospital_id");

-- AddForeignKey
ALTER TABLE "hospitals" ADD CONSTRAINT "hospitals_parent_hospital_id_fkey" FOREIGN KEY ("parent_hospital_id") REFERENCES "hospitals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
