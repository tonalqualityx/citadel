-- CreateEnum
CREATE TYPE "PortalChatSwitch" AS ENUM ('off', 'pilot', 'on');

-- CreateEnum
CREATE TYPE "ChatMode" AS ENUM ('model', 'tree');

-- CreateEnum
CREATE TYPE "ChatState" AS ENUM ('clarifying', 'confirming', 'filed', 'with_person', 'closed');

-- CreateEnum
CREATE TYPE "EngineJobStatus" AS ENUM ('queued', 'claimed', 'done', 'failed', 'expired');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'portal_chat_handoff';

-- AlterTable
ALTER TABLE "api_keys" ADD COLUMN     "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "app_settings" ADD COLUMN     "portal_chat_daily_cap_usd" DECIMAL(8,2) NOT NULL DEFAULT 30,
ADD COLUMN     "portal_chat_mode" "PortalChatSwitch" NOT NULL DEFAULT 'off',
ADD COLUMN     "portal_chat_pilot_contact_ids" UUID[] DEFAULT ARRAY[]::UUID[];

-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "chat_meta" JSONB,
ADD COLUMN     "source" VARCHAR(20);

-- AlterTable
ALTER TABLE "email_outbox" ADD COLUMN     "gmail_thread_id" VARCHAR(64),
ADD COLUMN     "reply_to" VARCHAR(320),
ADD COLUMN     "reply_to_gmail_id" VARCHAR(64),
ADD COLUMN     "rfc_message_id" VARCHAR(255),
ADD COLUMN     "task_id" UUID;

-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "ga4_property" VARCHAR(64),
ADD COLUMN     "gsc_property" VARCHAR(255),
ADD COLUMN     "portal_chat_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "portal_chat_conversations" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "site_id" UUID,
    "opened_by_contact_id" UUID NOT NULL,
    "intake_id" VARCHAR(64),
    "mode" "ChatMode" NOT NULL DEFAULT 'model',
    "state" "ChatState" NOT NULL DEFAULT 'clarifying',
    "slots" JSONB NOT NULL DEFAULT '{}',
    "summary_version" INTEGER NOT NULL DEFAULT 0,
    "summary_text" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "open_ask" JSONB,
    "email_token" VARCHAR(16) NOT NULL,
    "gmail_thread_id" VARCHAR(64),
    "last_outbound_gmail_id" VARCHAR(64),
    "away_sent_for_comment_id" UUID,
    "last_seen_at" TIMESTAMP(3),
    "last_typing_at" TIMESTAMP(3),
    "page_hidden_at" TIMESTAMP(3),
    "jobs_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_chat_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_jobs" (
    "id" UUID NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "status" "EngineJobStatus" NOT NULL DEFAULT 'queued',
    "conversation_id" UUID,
    "task_id" UUID,
    "client_id" UUID,
    "contact_id" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3),
    "lease_until" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "expired_at" TIMESTAMP(3),
    "gate_result" VARCHAR(20),
    "action_errors" JSONB,
    "error" TEXT,

    CONSTRAINT "engine_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_runs" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "model" VARCHAR(64) NOT NULL,
    "prompt_hash" VARCHAR(64) NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_write_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "duration_api_ms" INTEGER,
    "num_turns" INTEGER,
    "is_error" BOOLEAN NOT NULL DEFAULT false,
    "rejected_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engine_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_tool_calls" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "task_id" UUID,
    "conversation_id" UUID,
    "client_id" UUID NOT NULL,
    "tool" VARCHAR(40) NOT NULL,
    "args" JSONB NOT NULL,
    "row_count" INTEGER,
    "latency_ms" INTEGER,
    "error" TEXT,
    "result" JSONB,
    "result_numbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engine_tool_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_attachments" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "task_id" UUID,
    "comment_id" UUID,
    "conversation_id" UUID,
    "intake_id" VARCHAR(64),
    "uploaded_by_contact_id" UUID,
    "uploaded_by_user_id" UUID,
    "source" VARCHAR(10) NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "filename" VARCHAR(120) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "expired_at" TIMESTAMP(3),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_pages" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "url" VARCHAR(1000) NOT NULL,
    "path" VARCHAR(1000) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "sections" JSONB NOT NULL DEFAULT '[]',
    "depth" INTEGER NOT NULL DEFAULT 0,
    "source" VARCHAR(10) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "missing_since" TIMESTAMP(3),

    CONSTRAINT "site_pages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portal_chat_conversations_task_id_key" ON "portal_chat_conversations"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "portal_chat_conversations_intake_id_key" ON "portal_chat_conversations"("intake_id");

-- CreateIndex
CREATE UNIQUE INDEX "portal_chat_conversations_email_token_key" ON "portal_chat_conversations"("email_token");

-- CreateIndex
CREATE INDEX "portal_chat_conversations_state_updated_at_idx" ON "portal_chat_conversations"("state", "updated_at");

-- CreateIndex
CREATE INDEX "portal_chat_conversations_client_id_idx" ON "portal_chat_conversations"("client_id");

-- CreateIndex
CREATE INDEX "engine_jobs_status_queued_at_idx" ON "engine_jobs"("status", "queued_at");

-- CreateIndex
CREATE INDEX "engine_jobs_conversation_id_idx" ON "engine_jobs"("conversation_id");

-- CreateIndex
CREATE INDEX "engine_runs_job_id_idx" ON "engine_runs"("job_id");

-- CreateIndex
CREATE INDEX "engine_runs_created_at_idx" ON "engine_runs"("created_at");

-- CreateIndex
CREATE INDEX "engine_tool_calls_task_id_idx" ON "engine_tool_calls"("task_id");

-- CreateIndex
CREATE INDEX "engine_tool_calls_client_id_created_at_idx" ON "engine_tool_calls"("client_id", "created_at");

-- CreateIndex
CREATE INDEX "portal_attachments_task_id_idx" ON "portal_attachments"("task_id");

-- CreateIndex
CREATE INDEX "portal_attachments_conversation_id_idx" ON "portal_attachments"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_pages_site_id_path_key" ON "site_pages"("site_id", "path");

-- AddForeignKey
ALTER TABLE "portal_chat_conversations" ADD CONSTRAINT "portal_chat_conversations_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_chat_conversations" ADD CONSTRAINT "portal_chat_conversations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_chat_conversations" ADD CONSTRAINT "portal_chat_conversations_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_chat_conversations" ADD CONSTRAINT "portal_chat_conversations_opened_by_contact_id_fkey" FOREIGN KEY ("opened_by_contact_id") REFERENCES "client_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_jobs" ADD CONSTRAINT "engine_jobs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "portal_chat_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_runs" ADD CONSTRAINT "engine_runs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "engine_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_tool_calls" ADD CONSTRAINT "engine_tool_calls_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "engine_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_attachments" ADD CONSTRAINT "portal_attachments_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "portal_chat_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
