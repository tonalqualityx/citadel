-- CreateEnum
CREATE TYPE "WaitKind" AS ENUM ('approval', 'clock', 'handoff', 'meeting', 'external', 'switch');

-- CreateEnum
CREATE TYPE "WaitState" AS ENUM ('waiting', 'needs_human', 'paused', 'blocked_by_switch', 'done', 'expired');

-- CreateEnum
CREATE TYPE "WaitAction" AS ENUM ('proceed', 'send', 'escalate', 'task');

-- CreateEnum
CREATE TYPE "WaitUnit" AS ENUM ('hours', 'calendar_days', 'business_days');

-- CreateTable
CREATE TABLE "waits" (
    "id" UUID NOT NULL,
    "kind" "WaitKind" NOT NULL,
    "template_key" VARCHAR(80) NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 1,
    "title" VARCHAR(300) NOT NULL,
    "detail" TEXT,
    "owner_function_id" UUID,
    "owner_user_id" UUID,
    "owner_contact_id" UUID,
    "stand_in_user_id" UUID,
    "escalated_to_user_id" UUID,
    "client_id" UUID,
    "accord_id" UUID,
    "project_id" UUID,
    "charter_id" UUID,
    "site_id" UUID,
    "task_id" UUID,
    "arc_id" UUID,
    "approval_request_id" UUID,
    "email_thread_id" VARCHAR(255),
    "email_account" VARCHAR(255),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_value" INTEGER NOT NULL,
    "duration_unit" "WaitUnit" NOT NULL DEFAULT 'business_days',
    "due_at" TIMESTAMP(3) NOT NULL,
    "extended_bd_total" INTEGER NOT NULL DEFAULT 0,
    "extension_count" INTEGER NOT NULL DEFAULT 0,
    "blocks_client" BOOLEAN NOT NULL DEFAULT false,
    "client_waiting_since" TIMESTAMP(3),
    "state" "WaitState" NOT NULL DEFAULT 'waiting',
    "paused_until" TIMESTAMP(3),
    "paused_remaining_ms" BIGINT,
    "switch_key" VARCHAR(80),
    "terminal_action" "WaitAction" NOT NULL,
    "action_payload" JSONB,
    "claimed_at" TIMESTAMP(3),
    "fired_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "sent_message_id" VARCHAR(255),
    "fire_error" TEXT,
    "fire_error_count" INTEGER NOT NULL DEFAULT 0,
    "nag_level" INTEGER NOT NULL DEFAULT 0,
    "last_nag_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_by_automation" VARCHAR(80),
    "idempotency_key" VARCHAR(255),
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" UUID,
    "resolution" VARCHAR(80),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wait_events" (
    "id" UUID NOT NULL,
    "wait_id" UUID NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "from_due_at" TIMESTAMP(3),
    "to_due_at" TIMESTAMP(3),
    "from_state" VARCHAR(30),
    "to_state" VARCHAR(30),
    "reason" TEXT,
    "source" VARCHAR(30) NOT NULL,
    "actor_user_id" UUID,
    "email_message_id" VARCHAR(255),
    "event_id" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wait_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "waits_idempotency_key_key" ON "waits"("idempotency_key");

-- CreateIndex
CREATE INDEX "waits_state_due_at_idx" ON "waits"("state", "due_at");

-- CreateIndex
CREATE INDEX "waits_owner_user_id_state_idx" ON "waits"("owner_user_id", "state");

-- CreateIndex
CREATE INDEX "waits_owner_function_id_state_idx" ON "waits"("owner_function_id", "state");

-- CreateIndex
CREATE INDEX "waits_client_id_state_idx" ON "waits"("client_id", "state");

-- CreateIndex
CREATE INDEX "waits_project_id_idx" ON "waits"("project_id");

-- CreateIndex
CREATE INDEX "waits_charter_id_idx" ON "waits"("charter_id");

-- CreateIndex
CREATE INDEX "waits_task_id_idx" ON "waits"("task_id");

-- CreateIndex
CREATE INDEX "waits_email_thread_id_idx" ON "waits"("email_thread_id");

-- CreateIndex
CREATE INDEX "waits_switch_key_state_idx" ON "waits"("switch_key", "state");

-- CreateIndex
CREATE UNIQUE INDEX "wait_events_event_id_key" ON "wait_events"("event_id");

-- CreateIndex
CREATE INDEX "wait_events_wait_id_created_at_idx" ON "wait_events"("wait_id", "created_at");

-- AddForeignKey
ALTER TABLE "waits" ADD CONSTRAINT "waits_owner_function_id_fkey" FOREIGN KEY ("owner_function_id") REFERENCES "functions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waits" ADD CONSTRAINT "waits_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waits" ADD CONSTRAINT "waits_owner_contact_id_fkey" FOREIGN KEY ("owner_contact_id") REFERENCES "client_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waits" ADD CONSTRAINT "waits_stand_in_user_id_fkey" FOREIGN KEY ("stand_in_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waits" ADD CONSTRAINT "waits_escalated_to_user_id_fkey" FOREIGN KEY ("escalated_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waits" ADD CONSTRAINT "waits_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waits" ADD CONSTRAINT "waits_accord_id_fkey" FOREIGN KEY ("accord_id") REFERENCES "accords"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waits" ADD CONSTRAINT "waits_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waits" ADD CONSTRAINT "waits_charter_id_fkey" FOREIGN KEY ("charter_id") REFERENCES "charters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waits" ADD CONSTRAINT "waits_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waits" ADD CONSTRAINT "waits_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waits" ADD CONSTRAINT "waits_arc_id_fkey" FOREIGN KEY ("arc_id") REFERENCES "arcs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waits" ADD CONSTRAINT "waits_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waits" ADD CONSTRAINT "waits_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waits" ADD CONSTRAINT "waits_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wait_events" ADD CONSTRAINT "wait_events_wait_id_fkey" FOREIGN KEY ("wait_id") REFERENCES "waits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

