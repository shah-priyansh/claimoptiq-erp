-- Purchase-bill taxes & adjustments on expenses (mirrors the invoice):
-- GST is added, TDS is withheld, discount reduces and round-off adjusts, all on
-- the post-discount taxable base. `amount` stays the pre-tax subtotal used by
-- P&L / reports; these only change the net amount payable to the vendor.
-- All default 0 so every existing expense keeps payable == amount (no backfill).
ALTER TABLE "expenses" ADD COLUMN "discount"   DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "expenses" ADD COLUMN "gst_rate"   DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "expenses" ADD COLUMN "gst_amount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "expenses" ADD COLUMN "tds_rate"   DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "expenses" ADD COLUMN "tds_amount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "expenses" ADD COLUMN "round_off"  DOUBLE PRECISION NOT NULL DEFAULT 0;
