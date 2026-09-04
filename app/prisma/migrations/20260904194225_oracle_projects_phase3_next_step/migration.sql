-- Oracle Projects Tab Phase 3 — the next-step engine (implementation/plans/oracle-projects-tab.md).
-- Additive-only, two nullable columns on projects. Idempotent, matching the Phase 1
-- convention (ADD COLUMN IF NOT EXISTS) so a re-run of this file (`prisma db execute`)
-- is a clean no-op — see the plan's Gates section.

-- AlterTable: projects — Mike's override owner-label + the refresh-request stamp
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "next_step_owner_label" VARCHAR(255);
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "next_step_refresh_requested_at" TIMESTAMP(3);
