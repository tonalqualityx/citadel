-- Oracle Projects Tab Phase 1 — data + defaults (implementation/plans/oracle-projects-tab.md).
-- Additive-only + two default flips. Hand-edited from the Prisma-generated SQL to the
-- repo's idempotent-migration convention (ADD COLUMN IF NOT EXISTS, CREATE TYPE guarded
-- via DO $$ ... duplicate_object, CREATE TABLE/INDEX IF NOT EXISTS, FK guarded via a
-- pg_constraint existence check) so a re-run of this file (`prisma db execute`) is a
-- clean no-op — see the plan's Gates section.

-- CreateEnum, guarded (Postgres has no native CREATE TYPE ... IF NOT EXISTS)
DO $$ BEGIN
    CREATE TYPE "NextStepSource" AS ENUM ('graph', 'bast', 'mike');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "EmailMatchSource" AS ENUM ('auto', 'mike', 'unmatched');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "ProjectNoteKind" AS ENUM ('note', 'parked_until');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "ApprovalRequestStatus" AS ENUM ('draft', 'queued', 'sent', 'replied', 'approved', 'changes_requested', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "BlockerDismissalKind" AS ENUM ('mention', 'email', 'session_ask', 'task', 'meeting_risk', 'stale');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable: email_asks — auto-match columns
ALTER TABLE "email_asks" ADD COLUMN IF NOT EXISTS "client_id" UUID;
ALTER TABLE "email_asks" ADD COLUMN IF NOT EXISTS "match_source" "EmailMatchSource";
ALTER TABLE "email_asks" ADD COLUMN IF NOT EXISTS "project_id" UUID;

-- AlterTable: projects — next-step + email-summary + stale-mute columns
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "email_summary" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "email_summary_at" TIMESTAMP(3);
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "next_step_at" TIMESTAMP(3);
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "next_step_owner_id" UUID;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "next_step_source" "NextStepSource";
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "next_step_text" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "stale_muted_until" TIMESTAMP(3);

-- AlterTable: default flips (Mike's ruling, 2026-09-04) — naturally idempotent
ALTER TABLE "sops" ALTER COLUMN "needs_review" SET DEFAULT false;
ALTER TABLE "tasks" ALTER COLUMN "needs_review" SET DEFAULT false;
ALTER TABLE "tasks" ALTER COLUMN "is_billable" SET DEFAULT false;

-- CreateTable: project_notes
CREATE TABLE IF NOT EXISTS "project_notes" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "ProjectNoteKind" NOT NULL DEFAULT 'note',
    "body" TEXT NOT NULL,
    "until_date" TIMESTAMP(3),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable: approval_requests
CREATE TABLE IF NOT EXISTS "approval_requests" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "contact_id" UUID,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'draft',
    "subject" VARCHAR(500) NOT NULL,
    "body" TEXT NOT NULL,
    "to_email" VARCHAR(255),
    "draft_source" "NextStepSource",
    "message_id" VARCHAR(255),
    "thread_id" VARCHAR(255),
    "sent_at" TIMESTAMP(3),
    "replied_at" TIMESTAMP(3),
    "reply_excerpt" TEXT,
    "chase_after_days" INTEGER NOT NULL DEFAULT 3,
    "seen_in_meeting_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable: blocker_dismissals
CREATE TABLE IF NOT EXISTS "blocker_dismissals" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "kind" "BlockerDismissalKind" NOT NULL,
    "source_id" VARCHAR(255) NOT NULL,
    "source_marker" VARCHAR(255),
    "dismissed_by_id" UUID NOT NULL,
    "dismissed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "blocker_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "project_notes_project_id_idx" ON "project_notes"("project_id");
CREATE INDEX IF NOT EXISTS "project_notes_project_id_kind_idx" ON "project_notes"("project_id", "kind");
CREATE INDEX IF NOT EXISTS "approval_requests_task_id_idx" ON "approval_requests"("task_id");
CREATE INDEX IF NOT EXISTS "approval_requests_project_id_idx" ON "approval_requests"("project_id");
CREATE INDEX IF NOT EXISTS "approval_requests_status_idx" ON "approval_requests"("status");
CREATE INDEX IF NOT EXISTS "blocker_dismissals_project_id_kind_source_id_idx" ON "blocker_dismissals"("project_id", "kind", "source_id");
CREATE INDEX IF NOT EXISTS "email_asks_client_id_idx" ON "email_asks"("client_id");
CREATE INDEX IF NOT EXISTS "email_asks_project_id_idx" ON "email_asks"("project_id");

-- AddForeignKey, each guarded by a pg_constraint existence check
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_next_step_owner_id_fkey') THEN
        ALTER TABLE "projects" ADD CONSTRAINT "projects_next_step_owner_id_fkey" FOREIGN KEY ("next_step_owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_asks_client_id_fkey') THEN
        ALTER TABLE "email_asks" ADD CONSTRAINT "email_asks_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_asks_project_id_fkey') THEN
        ALTER TABLE "email_asks" ADD CONSTRAINT "email_asks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_notes_project_id_fkey') THEN
        ALTER TABLE "project_notes" ADD CONSTRAINT "project_notes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_notes_user_id_fkey') THEN
        ALTER TABLE "project_notes" ADD CONSTRAINT "project_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_requests_task_id_fkey') THEN
        ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_requests_project_id_fkey') THEN
        ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_requests_contact_id_fkey') THEN
        ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "client_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_requests_created_by_id_fkey') THEN
        ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blocker_dismissals_project_id_fkey') THEN
        ALTER TABLE "blocker_dismissals" ADD CONSTRAINT "blocker_dismissals_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blocker_dismissals_dismissed_by_id_fkey') THEN
        ALTER TABLE "blocker_dismissals" ADD CONSTRAINT "blocker_dismissals_dismissed_by_id_fkey" FOREIGN KEY ("dismissed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
