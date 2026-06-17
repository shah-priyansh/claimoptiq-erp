-- Pre-tax discount applied by the operator on a draft invoice. Subtracted
-- from gross before GST and TDS so the customer sees a reduced taxable value.
ALTER TABLE "invoices" ADD COLUMN "discount" DOUBLE PRECISION NOT NULL DEFAULT 0;
