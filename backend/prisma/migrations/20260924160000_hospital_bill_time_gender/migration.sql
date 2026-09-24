-- Bill Date time-of-day + patient Gender on the Hospital Final Bill.
ALTER TABLE "hospital_final_bills" ADD COLUMN "bill_time" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hospital_final_bills" ADD COLUMN "gender" TEXT NOT NULL DEFAULT '';
