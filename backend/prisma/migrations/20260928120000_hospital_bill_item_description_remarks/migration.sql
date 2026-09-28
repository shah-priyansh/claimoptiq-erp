-- Per-item Description (next to Particulars) + a whole-bill Remarks field.
ALTER TABLE "hospital_final_bill_items" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hospital_final_bills" ADD COLUMN "remarks" TEXT NOT NULL DEFAULT '';
