CREATE TABLE "direct_patient_billing_services" (
  "id" TEXT NOT NULL,
  "service_name" TEXT NOT NULL,
  "billing_type" TEXT NOT NULL,
  "fixed_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "claim_limit" INTEGER NOT NULL DEFAULT 0,
  "over_limit_behavior" TEXT NOT NULL DEFAULT 'per_claim',
  "over_limit_per_claim_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "over_limit_insurance_wise" BOOLEAN NOT NULL DEFAULT false,
  "over_limit_insurer_ids" JSONB NOT NULL DEFAULT '[]',
  "over_limit_tpa_ids" JSONB NOT NULL DEFAULT '[]',
  "slab_mode" TEXT NOT NULL DEFAULT 'slab_wise',
  "slab_range_start" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "slab_range_end" DOUBLE PRECISION NOT NULL DEFAULT 50000,
  "slab_base_price" DOUBLE PRECISION NOT NULL DEFAULT 2000,
  "slab_increment_range" DOUBLE PRECISION NOT NULL DEFAULT 50000,
  "slab_increment_price" DOUBLE PRECISION NOT NULL DEFAULT 500,
  "calculation_basis" TEXT NOT NULL DEFAULT 'none',
  "percentage_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "direct_patient_billing_services_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "direct_patient_billing_service_slabs" (
  "id" TEXT NOT NULL,
  "billing_service_id" TEXT NOT NULL,
  "range_start" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "range_end" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "direct_patient_billing_service_slabs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "direct_patient_billing_service_slabs"
  ADD CONSTRAINT "direct_patient_billing_service_slabs_billing_service_id_fkey"
  FOREIGN KEY ("billing_service_id")
  REFERENCES "direct_patient_billing_services"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
