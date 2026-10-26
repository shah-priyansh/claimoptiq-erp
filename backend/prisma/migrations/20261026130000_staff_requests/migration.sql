-- Employee-raised requests (OT / leave / off-day swap) with super-admin approval.
CREATE TABLE "staff_requests" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "date" DATE NOT NULL,
    "swap_worked_date" DATE,
    "ot_hours" DOUBLE PRECISION,
    "leave_paid" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT NOT NULL DEFAULT '',
    "review_note" TEXT NOT NULL DEFAULT '',
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "staff_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "staff_requests_employee_id_idx" ON "staff_requests"("employee_id");
CREATE INDEX "staff_requests_status_idx" ON "staff_requests"("status");

ALTER TABLE "staff_requests" ADD CONSTRAINT "staff_requests_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_requests" ADD CONSTRAINT "staff_requests_reviewed_by_id_fkey"
    FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
