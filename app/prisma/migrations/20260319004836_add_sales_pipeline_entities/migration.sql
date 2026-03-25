-- CreateEnum
CREATE TYPE "AccordStatus" AS ENUM ('lead', 'meeting', 'proposal', 'contract', 'signed', 'active', 'lost');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('draft', 'sent', 'accepted', 'rejected', 'changes_requested');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('draft', 'sent', 'signed');

-- CreateEnum
CREATE TYPE "AddendumStatus" AS ENUM ('draft', 'sent', 'accepted', 'rejected', 'changes_requested');

-- CreateEnum
CREATE TYPE "WareType" AS ENUM ('commission', 'charter');

-- CreateEnum
CREATE TYPE "CharterBillingPeriod" AS ENUM ('monthly', 'annually');

-- CreateEnum
CREATE TYPE "CharterStatus" AS ENUM ('active', 'paused', 'cancelled');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "accord_id" UUID,
ADD COLUMN     "scope_locked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scope_locked_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "accord_id" UUID,
ADD COLUMN     "charter_id" UUID;

-- CreateTable
CREATE TABLE "wares" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "type" "WareType" NOT NULL,
    "charter_billing_period" "CharterBillingPeriod",
    "base_price" DECIMAL(10,2),
    "price_tiers" JSONB,
    "contract_language" TEXT,
    "default_schedule" JSONB,
    "recipe_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accords" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "status" "AccordStatus" NOT NULL DEFAULT 'lead',
    "client_id" UUID,
    "owner_id" UUID NOT NULL,
    "lead_name" VARCHAR(255),
    "lead_business_name" VARCHAR(255),
    "lead_email" VARCHAR(255),
    "lead_phone" VARCHAR(50),
    "lead_notes" TEXT,
    "meeting_date" TIMESTAMP(3),
    "meeting_notes" TEXT,
    "meeting_transcript_url" VARCHAR(500),
    "meeting_recording_url" VARCHAR(500),
    "rejection_reason" TEXT,
    "payment_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "payment_confirmed_at" TIMESTAMP(3),
    "payment_confirmed_by_id" UUID,
    "total_value" DECIMAL(10,2),
    "entered_current_status_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lost_at" TIMESTAMP(3),
    "signed_at" TIMESTAMP(3),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accord_meeting_attendees" (
    "id" UUID NOT NULL,
    "accord_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accord_meeting_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accord_line_items" (
    "id" UUID NOT NULL,
    "accord_id" UUID NOT NULL,
    "ware_id" UUID NOT NULL,
    "name_override" VARCHAR(255),
    "description_override" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "commission_id" UUID,
    "charter_id" UUID,
    "contract_language_override" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "addendum_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accord_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposals" (
    "id" UUID NOT NULL,
    "accord_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'draft',
    "pricing_snapshot" JSONB NOT NULL,
    "sent_at" TIMESTAMP(3),
    "client_responded_at" TIMESTAMP(3),
    "client_note" TEXT,
    "portal_token" VARCHAR(128),
    "portal_token_expires_at" TIMESTAMP(3),
    "created_by_id" UUID NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "msa_versions" (
    "id" UUID NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "content" TEXT NOT NULL,
    "effective_date" DATE NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "change_summary" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "msa_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "accord_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "msa_version_id" UUID NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'draft',
    "pricing_snapshot" JSONB NOT NULL,
    "sent_at" TIMESTAMP(3),
    "signed_at" TIMESTAMP(3),
    "signer_name" VARCHAR(255),
    "signer_email" VARCHAR(255),
    "signer_ip" VARCHAR(45),
    "signer_user_agent" TEXT,
    "content_snapshot" TEXT,
    "portal_token" VARCHAR(128),
    "portal_token_expires_at" TIMESTAMP(3),
    "created_by_id" UUID NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addendums" (
    "id" UUID NOT NULL,
    "accord_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "contract_content" TEXT NOT NULL,
    "status" "AddendumStatus" NOT NULL DEFAULT 'draft',
    "pricing_snapshot" JSONB NOT NULL,
    "changes" JSONB NOT NULL,
    "sent_at" TIMESTAMP(3),
    "client_responded_at" TIMESTAMP(3),
    "client_note" TEXT,
    "signed_at" TIMESTAMP(3),
    "signer_name" VARCHAR(255),
    "signer_email" VARCHAR(255),
    "signer_ip" VARCHAR(45),
    "signer_user_agent" TEXT,
    "content_snapshot" TEXT,
    "portal_token" VARCHAR(128),
    "portal_token_expires_at" TIMESTAMP(3),
    "is_override" BOOLEAN NOT NULL DEFAULT false,
    "override_reason" TEXT,
    "overridden_by_id" UUID,
    "created_by_id" UUID NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "addendums_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_msa_signatures" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "msa_version_id" UUID NOT NULL,
    "signed_at" TIMESTAMP(3) NOT NULL,
    "signer_name" VARCHAR(255) NOT NULL,
    "signer_email" VARCHAR(255) NOT NULL,
    "signer_ip" VARCHAR(45),
    "signer_user_agent" TEXT,
    "portal_token" VARCHAR(128),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_msa_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charters" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "client_id" UUID NOT NULL,
    "accord_id" UUID,
    "status" "CharterStatus" NOT NULL DEFAULT 'active',
    "billing_period" "CharterBillingPeriod" NOT NULL,
    "budget_hours" DECIMAL(6,2),
    "hourly_rate" DECIMAL(8,2),
    "budget_amount" DECIMAL(10,2),
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "paused_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "created_by_id" UUID NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "charters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charter_wares" (
    "id" UUID NOT NULL,
    "charter_id" UUID NOT NULL,
    "ware_id" UUID NOT NULL,
    "accord_line_item_id" UUID,
    "price" DECIMAL(10,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deactivated_at" TIMESTAMP(3),
    "addendum_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "charter_wares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charter_scheduled_tasks" (
    "id" UUID NOT NULL,
    "charter_id" UUID NOT NULL,
    "charter_ware_id" UUID,
    "sop_id" UUID NOT NULL,
    "cadence" VARCHAR(20) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "charter_scheduled_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charter_generation_logs" (
    "id" UUID NOT NULL,
    "charter_id" UUID NOT NULL,
    "scheduled_task_id" UUID NOT NULL,
    "period" VARCHAR(20) NOT NULL,
    "tasks_created" INTEGER NOT NULL,
    "tasks_abandoned" INTEGER NOT NULL DEFAULT 0,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "charter_generation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charter_commissions" (
    "id" UUID NOT NULL,
    "charter_id" UUID NOT NULL,
    "commission_id" UUID NOT NULL,
    "allocated_hours_per_period" DECIMAL(6,2),
    "start_period" VARCHAR(20) NOT NULL,
    "end_period" VARCHAR(20),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "charter_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_sessions" (
    "id" UUID NOT NULL,
    "token_type" VARCHAR(20) NOT NULL,
    "entity_id" UUID NOT NULL,
    "ip_address" VARCHAR(45) NOT NULL,
    "user_agent" TEXT,
    "action" VARCHAR(20) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_automation_rules" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "trigger_type" VARCHAR(20) NOT NULL,
    "trigger_status" "AccordStatus" NOT NULL,
    "trigger_from_status" "AccordStatus",
    "time_threshold_hours" INTEGER,
    "action_type" VARCHAR(20) NOT NULL,
    "task_template" JSONB NOT NULL,
    "assignee_rule" VARCHAR(20) NOT NULL,
    "assignee_user_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wares_type_idx" ON "wares"("type");

-- CreateIndex
CREATE INDEX "wares_is_active_idx" ON "wares"("is_active");

-- CreateIndex
CREATE INDEX "accords_client_id_idx" ON "accords"("client_id");

-- CreateIndex
CREATE INDEX "accords_owner_id_idx" ON "accords"("owner_id");

-- CreateIndex
CREATE INDEX "accords_status_idx" ON "accords"("status");

-- CreateIndex
CREATE INDEX "accords_entered_current_status_at_idx" ON "accords"("entered_current_status_at");

-- CreateIndex
CREATE INDEX "accord_meeting_attendees_accord_id_idx" ON "accord_meeting_attendees"("accord_id");

-- CreateIndex
CREATE UNIQUE INDEX "accord_meeting_attendees_accord_id_user_id_key" ON "accord_meeting_attendees"("accord_id", "user_id");

-- CreateIndex
CREATE INDEX "accord_line_items_accord_id_idx" ON "accord_line_items"("accord_id");

-- CreateIndex
CREATE INDEX "accord_line_items_ware_id_idx" ON "accord_line_items"("ware_id");

-- CreateIndex
CREATE INDEX "accord_line_items_addendum_id_idx" ON "accord_line_items"("addendum_id");

-- CreateIndex
CREATE INDEX "proposals_accord_id_idx" ON "proposals"("accord_id");

-- CreateIndex
CREATE INDEX "proposals_portal_token_idx" ON "proposals"("portal_token");

-- CreateIndex
CREATE UNIQUE INDEX "proposals_accord_id_version_key" ON "proposals"("accord_id", "version");

-- CreateIndex
CREATE INDEX "contracts_accord_id_idx" ON "contracts"("accord_id");

-- CreateIndex
CREATE INDEX "contracts_portal_token_idx" ON "contracts"("portal_token");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_accord_id_version_key" ON "contracts"("accord_id", "version");

-- CreateIndex
CREATE INDEX "addendums_accord_id_idx" ON "addendums"("accord_id");

-- CreateIndex
CREATE INDEX "addendums_portal_token_idx" ON "addendums"("portal_token");

-- CreateIndex
CREATE UNIQUE INDEX "addendums_accord_id_version_key" ON "addendums"("accord_id", "version");

-- CreateIndex
CREATE INDEX "client_msa_signatures_client_id_idx" ON "client_msa_signatures"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_msa_signatures_client_id_msa_version_id_key" ON "client_msa_signatures"("client_id", "msa_version_id");

-- CreateIndex
CREATE INDEX "charters_client_id_idx" ON "charters"("client_id");

-- CreateIndex
CREATE INDEX "charters_accord_id_idx" ON "charters"("accord_id");

-- CreateIndex
CREATE INDEX "charters_status_idx" ON "charters"("status");

-- CreateIndex
CREATE INDEX "charter_wares_charter_id_idx" ON "charter_wares"("charter_id");

-- CreateIndex
CREATE INDEX "charter_wares_ware_id_idx" ON "charter_wares"("ware_id");

-- CreateIndex
CREATE INDEX "charter_scheduled_tasks_charter_id_idx" ON "charter_scheduled_tasks"("charter_id");

-- CreateIndex
CREATE INDEX "charter_scheduled_tasks_sop_id_idx" ON "charter_scheduled_tasks"("sop_id");

-- CreateIndex
CREATE INDEX "charter_generation_logs_charter_id_idx" ON "charter_generation_logs"("charter_id");

-- CreateIndex
CREATE UNIQUE INDEX "charter_generation_logs_charter_id_scheduled_task_id_period_key" ON "charter_generation_logs"("charter_id", "scheduled_task_id", "period");

-- CreateIndex
CREATE INDEX "charter_commissions_charter_id_idx" ON "charter_commissions"("charter_id");

-- CreateIndex
CREATE INDEX "charter_commissions_commission_id_idx" ON "charter_commissions"("commission_id");

-- CreateIndex
CREATE INDEX "portal_sessions_token_type_entity_id_idx" ON "portal_sessions"("token_type", "entity_id");

-- CreateIndex
CREATE INDEX "portal_sessions_created_at_idx" ON "portal_sessions"("created_at");

-- CreateIndex
CREATE INDEX "sales_automation_rules_trigger_status_idx" ON "sales_automation_rules"("trigger_status");

-- CreateIndex
CREATE INDEX "sales_automation_rules_is_active_idx" ON "sales_automation_rules"("is_active");

-- CreateIndex
CREATE INDEX "tasks_charter_id_idx" ON "tasks"("charter_id");

-- CreateIndex
CREATE INDEX "tasks_accord_id_idx" ON "tasks"("accord_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_accord_id_fkey" FOREIGN KEY ("accord_id") REFERENCES "accords"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_charter_id_fkey" FOREIGN KEY ("charter_id") REFERENCES "charters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_accord_id_fkey" FOREIGN KEY ("accord_id") REFERENCES "accords"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wares" ADD CONSTRAINT "wares_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accords" ADD CONSTRAINT "accords_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accords" ADD CONSTRAINT "accords_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accords" ADD CONSTRAINT "accords_payment_confirmed_by_id_fkey" FOREIGN KEY ("payment_confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accord_meeting_attendees" ADD CONSTRAINT "accord_meeting_attendees_accord_id_fkey" FOREIGN KEY ("accord_id") REFERENCES "accords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accord_meeting_attendees" ADD CONSTRAINT "accord_meeting_attendees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accord_line_items" ADD CONSTRAINT "accord_line_items_accord_id_fkey" FOREIGN KEY ("accord_id") REFERENCES "accords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accord_line_items" ADD CONSTRAINT "accord_line_items_ware_id_fkey" FOREIGN KEY ("ware_id") REFERENCES "wares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accord_line_items" ADD CONSTRAINT "accord_line_items_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accord_line_items" ADD CONSTRAINT "accord_line_items_charter_id_fkey" FOREIGN KEY ("charter_id") REFERENCES "charters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accord_line_items" ADD CONSTRAINT "accord_line_items_addendum_id_fkey" FOREIGN KEY ("addendum_id") REFERENCES "addendums"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_accord_id_fkey" FOREIGN KEY ("accord_id") REFERENCES "accords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "msa_versions" ADD CONSTRAINT "msa_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_accord_id_fkey" FOREIGN KEY ("accord_id") REFERENCES "accords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_msa_version_id_fkey" FOREIGN KEY ("msa_version_id") REFERENCES "msa_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addendums" ADD CONSTRAINT "addendums_accord_id_fkey" FOREIGN KEY ("accord_id") REFERENCES "accords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addendums" ADD CONSTRAINT "addendums_overridden_by_id_fkey" FOREIGN KEY ("overridden_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addendums" ADD CONSTRAINT "addendums_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_msa_signatures" ADD CONSTRAINT "client_msa_signatures_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_msa_signatures" ADD CONSTRAINT "client_msa_signatures_msa_version_id_fkey" FOREIGN KEY ("msa_version_id") REFERENCES "msa_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charters" ADD CONSTRAINT "charters_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charters" ADD CONSTRAINT "charters_accord_id_fkey" FOREIGN KEY ("accord_id") REFERENCES "accords"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charters" ADD CONSTRAINT "charters_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charter_wares" ADD CONSTRAINT "charter_wares_charter_id_fkey" FOREIGN KEY ("charter_id") REFERENCES "charters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charter_wares" ADD CONSTRAINT "charter_wares_ware_id_fkey" FOREIGN KEY ("ware_id") REFERENCES "wares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charter_wares" ADD CONSTRAINT "charter_wares_accord_line_item_id_fkey" FOREIGN KEY ("accord_line_item_id") REFERENCES "accord_line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charter_scheduled_tasks" ADD CONSTRAINT "charter_scheduled_tasks_charter_id_fkey" FOREIGN KEY ("charter_id") REFERENCES "charters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charter_scheduled_tasks" ADD CONSTRAINT "charter_scheduled_tasks_charter_ware_id_fkey" FOREIGN KEY ("charter_ware_id") REFERENCES "charter_wares"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charter_scheduled_tasks" ADD CONSTRAINT "charter_scheduled_tasks_sop_id_fkey" FOREIGN KEY ("sop_id") REFERENCES "sops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charter_generation_logs" ADD CONSTRAINT "charter_generation_logs_charter_id_fkey" FOREIGN KEY ("charter_id") REFERENCES "charters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charter_generation_logs" ADD CONSTRAINT "charter_generation_logs_scheduled_task_id_fkey" FOREIGN KEY ("scheduled_task_id") REFERENCES "charter_scheduled_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charter_commissions" ADD CONSTRAINT "charter_commissions_charter_id_fkey" FOREIGN KEY ("charter_id") REFERENCES "charters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charter_commissions" ADD CONSTRAINT "charter_commissions_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_automation_rules" ADD CONSTRAINT "sales_automation_rules_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
