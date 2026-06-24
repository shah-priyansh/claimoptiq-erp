-- AlterTable "claim_documents" — backup/offload tracking
ALTER TABLE "claim_documents" ADD COLUMN "is_synced" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "claim_documents" ADD COLUMN "storage_location" TEXT NOT NULL DEFAULT 'local';
ALTER TABLE "claim_documents" ADD COLUMN "remote_key" TEXT;
ALTER TABLE "claim_documents" ADD COLUMN "synced_at" TIMESTAMP(3);
ALTER TABLE "claim_documents" ADD COLUMN "local_deleted_at" TIMESTAMP(3);

CREATE INDEX "claim_documents_is_synced_storage_location_idx" ON "claim_documents"("is_synced", "storage_location");

-- AlterTable "document_submissions" — backup/offload tracking
ALTER TABLE "document_submissions" ADD COLUMN "is_synced" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "document_submissions" ADD COLUMN "storage_location" TEXT NOT NULL DEFAULT 'local';
ALTER TABLE "document_submissions" ADD COLUMN "remote_key" TEXT;
ALTER TABLE "document_submissions" ADD COLUMN "synced_at" TIMESTAMP(3);
ALTER TABLE "document_submissions" ADD COLUMN "local_deleted_at" TIMESTAMP(3);

CREATE INDEX "document_submissions_is_synced_storage_location_idx" ON "document_submissions"("is_synced", "storage_location");

-- CreateTable "backup_servers"
CREATE TABLE "backup_servers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 22,
    "username" TEXT NOT NULL,
    "auth_type" TEXT NOT NULL DEFAULT 'password',
    "enc_password" TEXT,
    "enc_private_key" TEXT,
    "enc_passphrase" TEXT,
    "remote_base_path" TEXT NOT NULL DEFAULT '/backups',
    "host_fingerprint" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "last_tested_at" TIMESTAMP(3),
    "last_test_ok" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backup_servers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "backup_servers_is_enabled_order_idx" ON "backup_servers"("is_enabled", "order");

-- CreateTable "file_backup_locations"
CREATE TABLE "file_backup_locations" (
    "id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "server_id" TEXT NOT NULL,
    "remote_key" TEXT NOT NULL,
    "remote_size" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "uploaded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "file_backup_locations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "file_backup_locations_source_type_source_id_server_id_key" ON "file_backup_locations"("source_type", "source_id", "server_id");
CREATE INDEX "file_backup_locations_source_type_source_id_idx" ON "file_backup_locations"("source_type", "source_id");
CREATE INDEX "file_backup_locations_server_id_status_idx" ON "file_backup_locations"("server_id", "status");

ALTER TABLE "file_backup_locations" ADD CONSTRAINT "file_backup_locations_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "backup_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable "backup_runs"
CREATE TABLE "backup_runs" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "triggered_by_id" TEXT,
    "files_scanned" INTEGER NOT NULL DEFAULT 0,
    "files_uploaded" INTEGER NOT NULL DEFAULT 0,
    "files_deleted" INTEGER NOT NULL DEFAULT 0,
    "bytes_freed" BIGINT NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "log" TEXT NOT NULL DEFAULT '',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "backup_runs_started_at_idx" ON "backup_runs"("started_at" DESC);

ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_triggered_by_id_fkey" FOREIGN KEY ("triggered_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
