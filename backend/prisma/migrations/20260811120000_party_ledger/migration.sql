-- Party ledger (Vyapar-style): a generic counterparty that unifies the entities
-- we invoice (hospitals) and pay (references / free-text expense parties). A
-- hospital or reference links here 1:1 via hospital_id / reference_id.
CREATE TABLE "parties" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "gstin" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "party_group" TEXT NOT NULL DEFAULT '',
    "gst_type" TEXT NOT NULL DEFAULT 'unregistered',
    "state" TEXT NOT NULL DEFAULT '',
    "billing_address" TEXT NOT NULL DEFAULT '',
    "shipping_address" TEXT NOT NULL DEFAULT '',
    "opening_balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "opening_type" TEXT NOT NULL DEFAULT 'to_collect',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "hospital_id" TEXT,
    "reference_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "parties_hospital_id_key" ON "parties"("hospital_id");
CREATE UNIQUE INDEX "parties_reference_id_key" ON "parties"("reference_id");
CREATE INDEX "parties_name_idx" ON "parties"("name");

ALTER TABLE "parties" ADD CONSTRAINT "parties_hospital_id_fkey" FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "parties" ADD CONSTRAINT "parties_reference_id_fkey" FOREIGN KEY ("reference_id") REFERENCES "references"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Party link on the two transaction tables.
ALTER TABLE "invoices" ADD COLUMN "party_id" TEXT;
ALTER TABLE "expenses" ADD COLUMN "party_id" TEXT;

CREATE INDEX "invoices_party_id_idx" ON "invoices"("party_id");
CREATE INDEX "expenses_party_id_idx" ON "expenses"("party_id");

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
