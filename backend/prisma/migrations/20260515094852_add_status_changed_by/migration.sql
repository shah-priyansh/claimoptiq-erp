-- AlterTable
ALTER TABLE "document_submissions" ADD COLUMN     "status_changed_at" TIMESTAMP(3),
ADD COLUMN     "status_changed_by_id" TEXT;

-- AddForeignKey
ALTER TABLE "document_submissions" ADD CONSTRAINT "document_submissions_status_changed_by_id_fkey" FOREIGN KEY ("status_changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
