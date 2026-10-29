-- Designer portal: automatic task timer (D10), follow-up renames and client-files (D11) catch-up.
-- live_url (the address main deploys to) is design_worker_state.site_live_urls, a JSON map beside site_main_roles.

-- AlterEnum (renames keep existing rows)
ALTER TYPE "DesignEventKind" RENAME VALUE 'scope' TO 'followup';
ALTER TYPE "DesignEventKind" ADD VALUE 'client_files';
ALTER TYPE "DesignPinStatus" RENAME VALUE 'out_of_scope' TO 'followup';
ALTER TYPE "DesignCommandVerb" ADD VALUE 'refresh_client_files';

-- AlterTable
ALTER TABLE "design_pins" RENAME COLUMN "scope_task_id" TO "followup_task_id";
ALTER TABLE "design_pins" ADD COLUMN     "tag" VARCHAR(40),
ADD COLUMN     "classes" VARCHAR(100)[] DEFAULT ARRAY[]::VARCHAR(100)[];

-- AlterTable
ALTER TABLE "design_sessions" ADD COLUMN     "timer_entry_id" UUID,
ADD COLUMN     "timer_presence_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "design_portal_settings" ADD COLUMN     "auto_timer_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "auto_timer_lapse_minutes" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "auto_timer_billable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "design_auto_timer" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "design_sessions_timer_presence_at_idx" ON "design_sessions"("timer_presence_at");

-- AlterTable
ALTER TABLE "design_worker_state" ADD COLUMN     "site_live_urls" JSONB;
