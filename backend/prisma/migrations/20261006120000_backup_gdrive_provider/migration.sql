-- AlterTable "backup_servers" — Google Drive as a second provider type.
-- Existing rows default to 'sftp'; host/username become optional (Drive has neither).
ALTER TABLE "backup_servers" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'sftp';
ALTER TABLE "backup_servers" ALTER COLUMN "host" DROP NOT NULL;
ALTER TABLE "backup_servers" ALTER COLUMN "username" DROP NOT NULL;
ALTER TABLE "backup_servers" ADD COLUMN "enc_gdrive_refresh_token" TEXT;
ALTER TABLE "backup_servers" ADD COLUMN "gdrive_account_email" TEXT;
ALTER TABLE "backup_servers" ADD COLUMN "gdrive_root_folder_name" TEXT;
