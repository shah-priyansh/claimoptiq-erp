-- CreateTable
CREATE TABLE "hospital_billing_service_slabs" (
    "id" TEXT NOT NULL,
    "billing_service_id" TEXT NOT NULL,
    "range_start" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "range_end" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "hospital_billing_service_slabs_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "hospital_billing_service_slabs" ADD CONSTRAINT "hospital_billing_service_slabs_billing_service_id_fkey" FOREIGN KEY ("billing_service_id") REFERENCES "hospital_billing_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
