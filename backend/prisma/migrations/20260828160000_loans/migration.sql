-- Loan module: a loan tracker with a reducing-balance EMI schedule.
-- direction 'given' = money FCC lent out (receivable/asset); 'taken' = money
-- FCC borrowed (payable/liability). Counterparty is a staff Employee, a Party,
-- or free-text. Loose refs (disburse_entry_id, cash_bank_entry_id,
-- salary_record_id) link to how money moved, without hard FKs.

CREATE TABLE "loans" (
  "id"                   TEXT NOT NULL,
  "direction"            TEXT NOT NULL,
  "counterparty_name"    TEXT NOT NULL DEFAULT '',
  "employee_id"          TEXT,
  "party_id"             TEXT,
  "principal"            DOUBLE PRECISION NOT NULL,
  "annual_interest_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "tenure_months"        INTEGER NOT NULL,
  "start_date"           TIMESTAMP(3) NOT NULL,
  "emi_amount"           DOUBLE PRECISION NOT NULL DEFAULT 0,
  "repayment_source"     TEXT NOT NULL DEFAULT 'manual',
  "status"               TEXT NOT NULL DEFAULT 'active',
  "disbursed_at"         TIMESTAMP(3),
  "disburse_entry_id"    TEXT,
  "notes"                TEXT NOT NULL DEFAULT '',
  "created_by_id"        TEXT,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "loans_direction_status_idx" ON "loans" ("direction", "status");
CREATE INDEX "loans_employee_id_idx" ON "loans" ("employee_id");
CREATE INDEX "loans_party_id_idx" ON "loans" ("party_id");

ALTER TABLE "loans" ADD CONSTRAINT "loans_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "loans" ADD CONSTRAINT "loans_party_id_fkey"
  FOREIGN KEY ("party_id") REFERENCES "parties" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "loans" ADD CONSTRAINT "loans_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "loan_installments" (
  "id"                  TEXT NOT NULL,
  "loan_id"             TEXT NOT NULL,
  "installment_no"      INTEGER NOT NULL,
  "due_date"            TIMESTAMP(3) NOT NULL,
  "emi_amount"          DOUBLE PRECISION NOT NULL,
  "principal_component" DOUBLE PRECISION NOT NULL,
  "interest_component"  DOUBLE PRECISION NOT NULL,
  "outstanding_after"   DOUBLE PRECISION NOT NULL,
  "status"              TEXT NOT NULL DEFAULT 'pending',
  "paid_amount"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "paid_date"           TIMESTAMP(3),
  "cash_bank_entry_id"  TEXT,
  "salary_record_id"    TEXT,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "loan_installments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "loan_installments_loan_id_installment_no_key" ON "loan_installments" ("loan_id", "installment_no");
CREATE INDEX "loan_installments_loan_id_idx" ON "loan_installments" ("loan_id");

ALTER TABLE "loan_installments" ADD CONSTRAINT "loan_installments_loan_id_fkey"
  FOREIGN KEY ("loan_id") REFERENCES "loans" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
