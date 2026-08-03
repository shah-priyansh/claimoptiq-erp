-- Password reset support: single-use hashed token + expiry.
-- Both columns are nullable and default to NULL, so existing rows are unaffected.
ALTER TABLE "users" ADD COLUMN "reset_token_hash" TEXT;
ALTER TABLE "users" ADD COLUMN "reset_token_expires_at" TIMESTAMP(3);
