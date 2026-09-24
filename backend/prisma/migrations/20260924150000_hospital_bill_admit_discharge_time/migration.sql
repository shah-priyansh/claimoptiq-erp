-- D.O.A./D.O.D. time-of-day for the Hospital Final Bill (Claim.dateOfAdmit/
-- dateOfDischarge store date only; the paper bill format always shows a time).
ALTER TABLE "hospital_final_bills" ADD COLUMN "admit_time" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hospital_final_bills" ADD COLUMN "discharge_time" TEXT NOT NULL DEFAULT '';
