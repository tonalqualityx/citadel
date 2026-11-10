-- CreateEnum
CREATE TYPE "BastChatRole" AS ENUM ('mike', 'assistant', 'tool', 'system');

-- CreateEnum
CREATE TYPE "BastChatKind" AS ENUM ('text', 'action', 'result', 'status', 'cost');

-- CreateEnum
CREATE TYPE "BastChatConversationStatus" AS ENUM ('idle', 'queued', 'running', 'closed');

-- CreateEnum
CREATE TYPE "BastChatActionStatus" AS ENUM ('applied', 'proposed', 'released', 'declined', 'undone', 'failed');

-- CreateTable
CREATE TABLE "bast_chat_conversations" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "status" "BastChatConversationStatus" NOT NULL DEFAULT 'idle',
    "title" VARCHAR(200),
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "live_text" TEXT,
    "live_action" VARCHAR(200),
    "model" VARCHAR(60),
    "cost_usd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "last_message_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "bast_chat_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bast_chat_events" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" "BastChatRole" NOT NULL,
    "kind" "BastChatKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "context" JSONB,
    "client_ref" VARCHAR(64),
    "turn" INTEGER,
    "delivered_at" TIMESTAMP(3),
    "expired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bast_chat_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bast_chat_actions" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "event_seq" INTEGER,
    "tool" VARCHAR(40) NOT NULL,
    "target_type" VARCHAR(20) NOT NULL,
    "target_id" UUID NOT NULL,
    "summary" VARCHAR(300) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "proposed_assignee_id" UUID,
    "status" "BastChatActionStatus" NOT NULL,
    "undo_until" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" UUID,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bast_chat_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bast_chat_usage" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "turns" INTEGER NOT NULL DEFAULT 0,
    "writes" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(10,4) NOT NULL DEFAULT 0,

    CONSTRAINT "bast_chat_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bast_chat_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "owner_user_id" UUID,
    "model" VARCHAR(60) NOT NULL DEFAULT 'sonnet',
    "effort" VARCHAR(10) NOT NULL DEFAULT 'low',
    "turn_budget_usd" DECIMAL(10,2) NOT NULL DEFAULT 0.40,
    "daily_turn_cap" INTEGER NOT NULL DEFAULT 100,
    "daily_write_cap" INTEGER NOT NULL DEFAULT 25,
    "daily_cost_cap_usd" DECIMAL(10,2) NOT NULL DEFAULT 8,
    "stale_after_minutes" INTEGER NOT NULL DEFAULT 120,
    "idle_close_minutes" INTEGER NOT NULL DEFAULT 10,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bast_chat_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bast_chat_worker_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_heartbeat_at" TIMESTAMP(3),
    "version" VARCHAR(40),
    "sdk_version" VARCHAR(40),
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "pause_reason" VARCHAR(100),
    "auth_state" VARCHAR(20),
    "live_conversations" INTEGER NOT NULL DEFAULT 0,
    "isolation_ok_at" TIMESTAMP(3),

    CONSTRAINT "bast_chat_worker_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bast_chat_conversations_owner_id_updated_at_idx" ON "bast_chat_conversations"("owner_id", "updated_at");

-- CreateIndex
CREATE INDEX "bast_chat_conversations_status_idx" ON "bast_chat_conversations"("status");

-- CreateIndex
CREATE INDEX "bast_chat_events_conversation_id_role_delivered_at_idx" ON "bast_chat_events"("conversation_id", "role", "delivered_at");

-- CreateIndex
CREATE UNIQUE INDEX "bast_chat_events_conversation_id_seq_key" ON "bast_chat_events"("conversation_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "bast_chat_events_conversation_id_client_ref_key" ON "bast_chat_events"("conversation_id", "client_ref");

-- CreateIndex
CREATE INDEX "bast_chat_actions_conversation_id_idx" ON "bast_chat_actions"("conversation_id");

-- CreateIndex
CREATE INDEX "bast_chat_actions_target_id_idx" ON "bast_chat_actions"("target_id");

-- CreateIndex
CREATE INDEX "bast_chat_actions_status_created_at_idx" ON "bast_chat_actions"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "bast_chat_usage_owner_id_day_key" ON "bast_chat_usage"("owner_id", "day");

-- AddForeignKey
ALTER TABLE "bast_chat_events" ADD CONSTRAINT "bast_chat_events_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "bast_chat_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bast_chat_actions" ADD CONSTRAINT "bast_chat_actions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "bast_chat_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

