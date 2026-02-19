-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'tech',
    "avatar_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "target_hours_per_week" INTEGER NOT NULL DEFAULT 40,
    "last_login_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "naming_convention" TEXT NOT NULL DEFAULT 'awesome',
    "theme" TEXT NOT NULL DEFAULT 'system',
    "notification_bundle" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "last_used_at" DATETIME,
    "expires_at" DATETIME,
    "is_revoked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" DATETIME,
    "bundle_key" TEXT,
    "bundle_count" INTEGER NOT NULL DEFAULT 1,
    "email_sent" BOOLEAN NOT NULL DEFAULT false,
    "email_sent_at" DATETIME,
    "slack_sent" BOOLEAN NOT NULL DEFAULT false,
    "slack_sent_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "notification_type" TEXT NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "slack" BOOLEAN NOT NULL DEFAULT false,
    "admin_override" BOOLEAN NOT NULL DEFAULT false,
    "overridden_by_id" TEXT,
    "overridden_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "slack_user_mappings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "display_name" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "slack_user_mappings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "slack_message_threads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "slack_channel" TEXT NOT NULL,
    "slack_ts" TEXT NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "email_digest_queue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "notification_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_digest_queue_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "slack_notification_batch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "notification_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "batch_key" TEXT NOT NULL,
    "batch_ready_at" DATETIME NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "slack_notification_batch_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "functions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "primary_focus" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "user_functions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "function_id" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_functions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_functions_function_id_fkey" FOREIGN KEY ("function_id") REFERENCES "functions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "hosting_plans" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "rate" REAL NOT NULL,
    "agency_rate" REAL,
    "monthly_cost" REAL,
    "vendor_plan" TEXT,
    "details" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "maintenance_plans" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "rate" REAL NOT NULL,
    "agency_rate" REAL,
    "hours" REAL,
    "details" TEXT,
    "frequency" TEXT NOT NULL DEFAULT 'monthly',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "maintenance_plan_sops" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "maintenance_plan_id" TEXT NOT NULL,
    "sop_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "maintenance_plan_sops_maintenance_plan_id_fkey" FOREIGN KEY ("maintenance_plan_id") REFERENCES "maintenance_plans" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "maintenance_plan_sops_sop_id_fkey" FOREIGN KEY ("sop_id") REFERENCES "sops" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tools" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "url" TEXT,
    "description" TEXT,
    "license_key" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "config" TEXT NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" DATETIME NOT NULL,
    "updated_by" TEXT
);

-- CreateTable
CREATE TABLE "dns_providers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'direct',
    "status" TEXT NOT NULL DEFAULT 'active',
    "primary_contact" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "retainer_hours" REAL,
    "hourly_rate" REAL,
    "retainer_usage_mode" TEXT NOT NULL DEFAULT 'medium',
    "parent_agency_id" TEXT,
    "notes" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "clients_parent_agency_id_fkey" FOREIGN KEY ("parent_agency_id") REFERENCES "clients" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sites" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "client_id" TEXT,
    "hosted_by" TEXT NOT NULL DEFAULT 'indelible',
    "platform" TEXT,
    "hosting_plan_id" TEXT,
    "hosting_discount" REAL,
    "maintenance_plan_id" TEXT,
    "maintenance_assignee_id" TEXT,
    "notes" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "sites_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "sites_hosting_plan_id_fkey" FOREIGN KEY ("hosting_plan_id") REFERENCES "hosting_plans" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "sites_maintenance_plan_id_fkey" FOREIGN KEY ("maintenance_plan_id") REFERENCES "maintenance_plans" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "sites_maintenance_assignee_id_fkey" FOREIGN KEY ("maintenance_assignee_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "domains" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "site_id" TEXT,
    "registrar" TEXT,
    "expires_at" DATETIME,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "registered_by" TEXT,
    "dns_provider_id" TEXT,
    "dns_managed_by" TEXT,
    "notes" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "domains_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "domains_dns_provider_id_fkey" FOREIGN KEY ("dns_provider_id") REFERENCES "dns_providers" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'quote',
    "client_id" TEXT NOT NULL,
    "site_id" TEXT,
    "recipe_id" TEXT,
    "type" TEXT NOT NULL DEFAULT 'project',
    "start_date" DATETIME,
    "target_date" DATETIME,
    "completed_date" DATETIME,
    "billing_type" TEXT,
    "budget_hours" REAL,
    "hourly_rate" REAL,
    "budget_amount" REAL,
    "budget_locked" BOOLEAN NOT NULL DEFAULT false,
    "budget_locked_at" DATETIME,
    "budget_locked_by_id" TEXT,
    "is_retainer" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "created_by_id" TEXT,
    CONSTRAINT "projects_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "projects_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "projects_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "projects_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "project_phases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "project_phases_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "resource_links" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "icon" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "resource_links_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "project_team_assignments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "function_id" TEXT NOT NULL,
    "is_lead" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_team_assignments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "project_team_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "project_team_assignments_function_id_fkey" FOREIGN KEY ("function_id") REFERENCES "functions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "priority" INTEGER NOT NULL DEFAULT 3,
    "is_focus" BOOLEAN NOT NULL DEFAULT false,
    "project_id" TEXT,
    "client_id" TEXT,
    "site_id" TEXT,
    "is_maintenance_task" BOOLEAN NOT NULL DEFAULT false,
    "maintenance_period" TEXT,
    "phase" TEXT,
    "phase_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "assignee_id" TEXT,
    "function_id" TEXT,
    "energy_estimate" INTEGER,
    "mystery_factor" TEXT NOT NULL DEFAULT 'none',
    "estimated_minutes" INTEGER,
    "battery_impact" TEXT NOT NULL DEFAULT 'average_drain',
    "due_date" DATETIME,
    "started_at" DATETIME,
    "completed_at" DATETIME,
    "requirements" TEXT,
    "review_requirements" TEXT,
    "needs_review" BOOLEAN NOT NULL DEFAULT true,
    "reviewer_id" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "approved_at" DATETIME,
    "approved_by_id" TEXT,
    "sop_id" TEXT,
    "invoiced" BOOLEAN NOT NULL DEFAULT false,
    "invoiced_at" DATETIME,
    "invoiced_by_id" TEXT,
    "is_billable" BOOLEAN NOT NULL DEFAULT true,
    "billing_target" REAL,
    "is_retainer_work" BOOLEAN NOT NULL DEFAULT false,
    "is_support" BOOLEAN NOT NULL DEFAULT false,
    "billing_amount" REAL,
    "waive_overage" BOOLEAN NOT NULL DEFAULT false,
    "no_time_needed" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "created_by_id" TEXT,
    CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "tasks_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "tasks_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "tasks_phase_id_fkey" FOREIGN KEY ("phase_id") REFERENCES "project_phases" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "tasks_function_id_fkey" FOREIGN KEY ("function_id") REFERENCES "functions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "tasks_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "tasks_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "tasks_sop_id_fkey" FOREIGN KEY ("sop_id") REFERENCES "sops" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "tasks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "milestones" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "phase_id" TEXT,
    "target_date" DATETIME,
    "completed_at" DATETIME,
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "billing_amount" REAL,
    "billing_status" TEXT NOT NULL DEFAULT 'pending',
    "triggered_at" DATETIME,
    "triggered_by_id" TEXT,
    "invoiced_at" DATETIME,
    "invoiced_by_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "milestones_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "milestones_phase_id_fkey" FOREIGN KEY ("phase_id") REFERENCES "project_phases" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "default_type" TEXT NOT NULL DEFAULT 'project',
    "requires_sitemap" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "recipe_phases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipe_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "recipe_phases_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "recipe_tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phase_id" TEXT NOT NULL,
    "sop_id" TEXT NOT NULL,
    "title" TEXT,
    "is_variable" BOOLEAN NOT NULL DEFAULT false,
    "variable_source" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "depends_on_ids" TEXT NOT NULL,
    CONSTRAINT "recipe_tasks_phase_id_fkey" FOREIGN KEY ("phase_id") REFERENCES "recipe_phases" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "recipe_tasks_sop_id_fkey" FOREIGN KEY ("sop_id") REFERENCES "sops" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sops" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "function_id" TEXT,
    "tags" TEXT NOT NULL,
    "default_priority" INTEGER NOT NULL DEFAULT 3,
    "energy_estimate" INTEGER,
    "mystery_factor" TEXT NOT NULL DEFAULT 'none',
    "battery_impact" TEXT NOT NULL DEFAULT 'average_drain',
    "estimated_minutes" INTEGER,
    "needs_review" BOOLEAN NOT NULL DEFAULT true,
    "template_requirements" TEXT,
    "setup_requirements" TEXT,
    "review_requirements" TEXT,
    "last_reviewed_at" DATETIME,
    "next_review_at" DATETIME,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "sops_function_id_fkey" FOREIGN KEY ("function_id") REFERENCES "functions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "project_pages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "page_type" TEXT,
    "needs_design" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "project_pages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "time_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "task_id" TEXT,
    "project_id" TEXT,
    "started_at" DATETIME NOT NULL,
    "ended_at" DATETIME,
    "duration" INTEGER NOT NULL DEFAULT 0,
    "is_running" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "is_billable" BOOLEAN NOT NULL DEFAULT true,
    "hourly_rate" REAL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "time_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "time_entries_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "time_entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "entity_name" TEXT,
    "changes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "used_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "maintenance_generation_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "maintenance_plan_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "tasks_created" INTEGER NOT NULL,
    "tasks_abandoned" INTEGER NOT NULL DEFAULT 0,
    "generated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "maintenance_generation_logs_maintenance_plan_id_fkey" FOREIGN KEY ("maintenance_plan_id") REFERENCES "maintenance_plans" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "maintenance_generation_logs_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "app_settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "bug_report_project_id" TEXT,
    "bug_report_phase_id" TEXT,
    "bug_report_notify_user_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "app_settings_bug_report_project_id_fkey" FOREIGN KEY ("bug_report_project_id") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "app_settings_bug_report_phase_id_fkey" FOREIGN KEY ("bug_report_phase_id") REFERENCES "project_phases" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "app_settings_bug_report_notify_user_id_fkey" FOREIGN KEY ("bug_report_notify_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_TaskDependencies" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_TaskDependencies_A_fkey" FOREIGN KEY ("A") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_TaskDependencies_B_fkey" FOREIGN KEY ("B") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_user_id_key" ON "user_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_token_key" ON "sessions"("refresh_token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "api_keys_key_hash_idx" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_user_id_idx" ON "api_keys"("user_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");

-- CreateIndex
CREATE INDEX "notifications_is_read_idx" ON "notifications"("is_read");

-- CreateIndex
CREATE INDEX "notifications_bundle_key_idx" ON "notifications"("bundle_key");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- CreateIndex
CREATE INDEX "notification_preferences_user_id_idx" ON "notification_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_notification_type_key" ON "notification_preferences"("user_id", "notification_type");

-- CreateIndex
CREATE UNIQUE INDEX "slack_user_mappings_user_id_key" ON "slack_user_mappings"("user_id");

-- CreateIndex
CREATE INDEX "slack_user_mappings_slack_user_id_idx" ON "slack_user_mappings"("slack_user_id");

-- CreateIndex
CREATE INDEX "slack_message_threads_slack_ts_idx" ON "slack_message_threads"("slack_ts");

-- CreateIndex
CREATE UNIQUE INDEX "slack_message_threads_entity_type_entity_id_slack_user_id_key" ON "slack_message_threads"("entity_type", "entity_id", "slack_user_id");

-- CreateIndex
CREATE INDEX "email_digest_queue_user_id_idx" ON "email_digest_queue"("user_id");

-- CreateIndex
CREATE INDEX "email_digest_queue_processed_created_at_idx" ON "email_digest_queue"("processed", "created_at");

-- CreateIndex
CREATE INDEX "slack_notification_batch_user_id_idx" ON "slack_notification_batch"("user_id");

-- CreateIndex
CREATE INDEX "slack_notification_batch_batch_key_processed_idx" ON "slack_notification_batch"("batch_key", "processed");

-- CreateIndex
CREATE INDEX "slack_notification_batch_batch_ready_at_processed_idx" ON "slack_notification_batch"("batch_ready_at", "processed");

-- CreateIndex
CREATE INDEX "user_functions_user_id_idx" ON "user_functions"("user_id");

-- CreateIndex
CREATE INDEX "user_functions_function_id_idx" ON "user_functions"("function_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_functions_user_id_function_id_key" ON "user_functions"("user_id", "function_id");

-- CreateIndex
CREATE INDEX "maintenance_plan_sops_maintenance_plan_id_idx" ON "maintenance_plan_sops"("maintenance_plan_id");

-- CreateIndex
CREATE INDEX "maintenance_plan_sops_sop_id_idx" ON "maintenance_plan_sops"("sop_id");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_plan_sops_maintenance_plan_id_sop_id_key" ON "maintenance_plan_sops"("maintenance_plan_id", "sop_id");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_provider_key" ON "integrations"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "dns_providers_name_key" ON "dns_providers"("name");

-- CreateIndex
CREATE INDEX "clients_type_idx" ON "clients"("type");

-- CreateIndex
CREATE INDEX "clients_status_idx" ON "clients"("status");

-- CreateIndex
CREATE INDEX "clients_parent_agency_id_idx" ON "clients"("parent_agency_id");

-- CreateIndex
CREATE INDEX "sites_client_id_idx" ON "sites"("client_id");

-- CreateIndex
CREATE INDEX "sites_hosting_plan_id_idx" ON "sites"("hosting_plan_id");

-- CreateIndex
CREATE INDEX "sites_maintenance_plan_id_idx" ON "sites"("maintenance_plan_id");

-- CreateIndex
CREATE INDEX "sites_maintenance_assignee_id_idx" ON "sites"("maintenance_assignee_id");

-- CreateIndex
CREATE INDEX "domains_site_id_idx" ON "domains"("site_id");

-- CreateIndex
CREATE INDEX "domains_dns_provider_id_idx" ON "domains"("dns_provider_id");

-- CreateIndex
CREATE INDEX "projects_client_id_idx" ON "projects"("client_id");

-- CreateIndex
CREATE INDEX "projects_recipe_id_idx" ON "projects"("recipe_id");

-- CreateIndex
CREATE INDEX "projects_site_id_idx" ON "projects"("site_id");

-- CreateIndex
CREATE INDEX "projects_status_idx" ON "projects"("status");

-- CreateIndex
CREATE INDEX "projects_type_idx" ON "projects"("type");

-- CreateIndex
CREATE INDEX "project_phases_project_id_idx" ON "project_phases"("project_id");

-- CreateIndex
CREATE INDEX "resource_links_project_id_idx" ON "resource_links"("project_id");

-- CreateIndex
CREATE INDEX "project_team_assignments_project_id_idx" ON "project_team_assignments"("project_id");

-- CreateIndex
CREATE INDEX "project_team_assignments_user_id_idx" ON "project_team_assignments"("user_id");

-- CreateIndex
CREATE INDEX "project_team_assignments_function_id_idx" ON "project_team_assignments"("function_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_team_assignments_project_id_function_id_key" ON "project_team_assignments"("project_id", "function_id");

-- CreateIndex
CREATE INDEX "tasks_project_id_idx" ON "tasks"("project_id");

-- CreateIndex
CREATE INDEX "tasks_client_id_idx" ON "tasks"("client_id");

-- CreateIndex
CREATE INDEX "tasks_site_id_idx" ON "tasks"("site_id");

-- CreateIndex
CREATE INDEX "tasks_assignee_id_idx" ON "tasks"("assignee_id");

-- CreateIndex
CREATE INDEX "tasks_status_idx" ON "tasks"("status");

-- CreateIndex
CREATE INDEX "tasks_priority_idx" ON "tasks"("priority");

-- CreateIndex
CREATE INDEX "tasks_phase_idx" ON "tasks"("phase");

-- CreateIndex
CREATE INDEX "tasks_phase_id_idx" ON "tasks"("phase_id");

-- CreateIndex
CREATE INDEX "tasks_sop_id_idx" ON "tasks"("sop_id");

-- CreateIndex
CREATE INDEX "tasks_invoiced_idx" ON "tasks"("invoiced");

-- CreateIndex
CREATE INDEX "tasks_is_maintenance_task_idx" ON "tasks"("is_maintenance_task");

-- CreateIndex
CREATE INDEX "tasks_is_support_idx" ON "tasks"("is_support");

-- CreateIndex
CREATE INDEX "milestones_project_id_idx" ON "milestones"("project_id");

-- CreateIndex
CREATE INDEX "milestones_phase_id_idx" ON "milestones"("phase_id");

-- CreateIndex
CREATE INDEX "milestones_billing_status_idx" ON "milestones"("billing_status");

-- CreateIndex
CREATE INDEX "recipe_phases_recipe_id_idx" ON "recipe_phases"("recipe_id");

-- CreateIndex
CREATE INDEX "recipe_tasks_phase_id_idx" ON "recipe_tasks"("phase_id");

-- CreateIndex
CREATE INDEX "recipe_tasks_sop_id_idx" ON "recipe_tasks"("sop_id");

-- CreateIndex
CREATE INDEX "sops_function_id_idx" ON "sops"("function_id");

-- CreateIndex
CREATE INDEX "project_pages_project_id_idx" ON "project_pages"("project_id");

-- CreateIndex
CREATE INDEX "time_entries_user_id_idx" ON "time_entries"("user_id");

-- CreateIndex
CREATE INDEX "time_entries_task_id_idx" ON "time_entries"("task_id");

-- CreateIndex
CREATE INDEX "time_entries_project_id_idx" ON "time_entries"("project_id");

-- CreateIndex
CREATE INDEX "time_entries_started_at_idx" ON "time_entries"("started_at");

-- CreateIndex
CREATE INDEX "time_entries_is_running_idx" ON "time_entries"("is_running");

-- CreateIndex
CREATE INDEX "activity_logs_entity_type_entity_id_idx" ON "activity_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "activity_logs_user_id_idx" ON "activity_logs"("user_id");

-- CreateIndex
CREATE INDEX "activity_logs_created_at_idx" ON "activity_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_key" ON "password_reset_tokens"("token");

-- CreateIndex
CREATE INDEX "password_reset_tokens_token_idx" ON "password_reset_tokens"("token");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "comments_task_id_idx" ON "comments"("task_id");

-- CreateIndex
CREATE INDEX "comments_user_id_idx" ON "comments"("user_id");

-- CreateIndex
CREATE INDEX "comments_created_at_idx" ON "comments"("created_at");

-- CreateIndex
CREATE INDEX "maintenance_generation_logs_maintenance_plan_id_idx" ON "maintenance_generation_logs"("maintenance_plan_id");

-- CreateIndex
CREATE INDEX "maintenance_generation_logs_site_id_idx" ON "maintenance_generation_logs"("site_id");

-- CreateIndex
CREATE INDEX "maintenance_generation_logs_period_idx" ON "maintenance_generation_logs"("period");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_generation_logs_maintenance_plan_id_site_id_period_key" ON "maintenance_generation_logs"("maintenance_plan_id", "site_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "_TaskDependencies_AB_unique" ON "_TaskDependencies"("A", "B");

-- CreateIndex
CREATE INDEX "_TaskDependencies_B_index" ON "_TaskDependencies"("B");
