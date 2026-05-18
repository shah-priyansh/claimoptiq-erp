-- DropForeignKey
ALTER TABLE "document_submissions" DROP CONSTRAINT "document_submissions_document_type_id_fkey";

-- AlterTable
ALTER TABLE "document_submissions" ALTER COLUMN "document_type_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "document_submissions" ADD CONSTRAINT "document_submissions_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "claim_document_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
