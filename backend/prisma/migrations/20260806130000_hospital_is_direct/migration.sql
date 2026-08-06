-- AlterTable "hospitals" — flag a hospital as direct
ALTER TABLE "hospitals" ADD COLUMN "is_direct" BOOLEAN NOT NULL DEFAULT false;
