-- Portal phase B slice 1: request intake. Additive only.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'portal_emergency';

ALTER TABLE "tasks" ADD COLUMN "client_title" VARCHAR(500);
ALTER TABLE "tasks" ADD COLUMN "client_intake" JSONB;
