-- Legal/billing name "as per bank" on the hospital master. Blank by default so
-- existing hospitals keep billing under their brand name (`name`) until set.
ALTER TABLE "hospitals" ADD COLUMN "invoice_name" TEXT NOT NULL DEFAULT '';
