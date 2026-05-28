-- CreateTable
CREATE TABLE "claim_status_history" (
    "id" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by_id" TEXT,

    CONSTRAINT "claim_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "claim_status_history_claim_id_changed_at_idx" ON "claim_status_history"("claim_id", "changed_at");

-- AddForeignKey
ALTER TABLE "claim_status_history" ADD CONSTRAINT "claim_status_history_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_status_history" ADD CONSTRAINT "claim_status_history_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: seed one history row per existing claim with its current status and creation date
INSERT INTO "claim_status_history" ("id", "claim_id", "status", "changed_at", "changed_by_id")
SELECT gen_random_uuid()::text, "id", "status", "created_at", "created_by_id"
FROM "claims";
