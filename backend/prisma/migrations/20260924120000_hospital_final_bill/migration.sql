-- Hospital Final Bill: an itemized IPD-style bill FCC can generate on the
-- hospital's behalf, linked 1:1 to a claim. finalAmount is mirrored into
-- claims.hospital_final_bill on save so existing downstream calculations
-- keep working unchanged. Bill numbers auto-increment per hospital.

ALTER TABLE "hospitals" ADD COLUMN "hospital_bill_start_no" TEXT NOT NULL DEFAULT '';

ALTER TABLE "claims" ADD COLUMN "is_hospital_bill_generated_by_us" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "hospital_final_bills" (
  "id"                 TEXT NOT NULL,
  "claim_id"           TEXT NOT NULL,
  "hospital_id"        TEXT NOT NULL,
  "bill_no"            INTEGER NOT NULL,
  "bill_no_formatted"  TEXT NOT NULL,
  "bill_date"          TIMESTAMP(3) NOT NULL,
  "opd_no"             TEXT NOT NULL DEFAULT '',
  "patient_dob"        TIMESTAMP(3),
  "patient_age"        INTEGER,
  "indoor_no"          TEXT NOT NULL DEFAULT '',
  "room_type"          TEXT NOT NULL DEFAULT '',
  "total_amount"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "discount"           DOUBLE PRECISION NOT NULL DEFAULT 0,
  "final_amount"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "created_by_id"      TEXT,
  "updated_by_id"      TEXT,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hospital_final_bills_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hospital_final_bills_claim_id_key" ON "hospital_final_bills" ("claim_id");
CREATE UNIQUE INDEX "hospital_final_bills_hospital_id_bill_no_key" ON "hospital_final_bills" ("hospital_id", "bill_no");

ALTER TABLE "hospital_final_bills" ADD CONSTRAINT "hospital_final_bills_claim_id_fkey"
  FOREIGN KEY ("claim_id") REFERENCES "claims" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hospital_final_bills" ADD CONSTRAINT "hospital_final_bills_hospital_id_fkey"
  FOREIGN KEY ("hospital_id") REFERENCES "hospitals" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospital_final_bills" ADD CONSTRAINT "hospital_final_bills_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hospital_final_bills" ADD CONSTRAINT "hospital_final_bills_updated_by_id_fkey"
  FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "hospital_final_bill_items" (
  "id"             TEXT NOT NULL,
  "bill_id"        TEXT NOT NULL,
  "sr_no"          INTEGER NOT NULL,
  "particulars"    TEXT NOT NULL,
  "rate"           DOUBLE PRECISION NOT NULL DEFAULT 0,
  "qty_raw"        TEXT NOT NULL DEFAULT '1',
  "qty_is_percent" BOOLEAN NOT NULL DEFAULT false,
  "qty_value"      DOUBLE PRECISION NOT NULL DEFAULT 1,
  "amount"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  CONSTRAINT "hospital_final_bill_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "hospital_final_bill_items_bill_id_idx" ON "hospital_final_bill_items" ("bill_id");

ALTER TABLE "hospital_final_bill_items" ADD CONSTRAINT "hospital_final_bill_items_bill_id_fkey"
  FOREIGN KEY ("bill_id") REFERENCES "hospital_final_bills" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
