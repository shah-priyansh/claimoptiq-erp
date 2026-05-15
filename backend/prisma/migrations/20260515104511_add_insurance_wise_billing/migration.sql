-- AlterTable
ALTER TABLE "hospital_billing_services" ADD COLUMN     "over_limit_insurance_wise" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "over_limit_insurer_ids" JSONB NOT NULL DEFAULT '[]',
ALTER COLUMN "over_limit_behavior" SET DEFAULT 'per_claim';
