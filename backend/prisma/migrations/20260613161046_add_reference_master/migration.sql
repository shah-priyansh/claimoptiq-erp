-- CreateTable "references"
CREATE TABLE "references" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "commission_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "references_pkey" PRIMARY KEY ("id")
);

-- CreateTable "reference_applicable_services"
CREATE TABLE "reference_applicable_services" (
    "id" TEXT NOT NULL,
    "reference_id" TEXT NOT NULL,
    "billing_service_name_id" TEXT NOT NULL,

    CONSTRAINT "reference_applicable_services_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey to "reference_applicable_services" -> "references"
ALTER TABLE "reference_applicable_services" ADD CONSTRAINT "reference_applicable_services_reference_id_fkey" FOREIGN KEY ("reference_id") REFERENCES "references"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey to "reference_applicable_services" -> "billing_service_names"
ALTER TABLE "reference_applicable_services" ADD CONSTRAINT "reference_applicable_services_billing_service_name_id_fkey" FOREIGN KEY ("billing_service_name_id") REFERENCES "billing_service_names"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddColumn "reference_id" to "hospitals"
ALTER TABLE "hospitals" ADD COLUMN "reference_id" TEXT;

-- AddForeignKey to "hospitals" -> "references"
ALTER TABLE "hospitals" ADD CONSTRAINT "hospitals_reference_id_fkey" FOREIGN KEY ("reference_id") REFERENCES "references"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex on "references"(name)
CREATE INDEX "references_name_idx" ON "references"("name");

-- CreateUnique index on "reference_applicable_services"(reference_id, billing_service_name_id)
CREATE UNIQUE INDEX "reference_applicable_services_reference_id_billing_service_n_key" ON "reference_applicable_services"("reference_id", "billing_service_name_id");
