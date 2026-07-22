-- Clarity Phase 4b — Intake drawer archive-intent + training notes. Additive only.

-- AlterEnum
ALTER TYPE "EmailAskState" ADD VALUE IF NOT EXISTS 'archive_requested';

-- AlterTable
ALTER TABLE "email_asks" ADD COLUMN "training_note" TEXT;
