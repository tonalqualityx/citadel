-- CreateEnum
CREATE TYPE "ChecklistKind" AS ENUM ('onboarding', 'offboarding', 'takeover');

-- AlterTable
ALTER TABLE "accords" ADD COLUMN     "kpi_proposal" JSONB;

-- CreateTable
CREATE TABLE "site_kpis" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "site_id" UUID,
    "accord_id" UUID,
    "charter_id" UUID,
    "metric" VARCHAR(60) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "direction" VARCHAR(4) NOT NULL,
    "baseline_value" DECIMAL(14,2),
    "baseline_at" TIMESTAMP(3),
    "target_value" DECIMAL(14,2),
    "target_by" DATE,
    "source" VARCHAR(30) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'proposed',
    "confirmed_at" TIMESTAMP(3),
    "last_value" DECIMAL(14,2),
    "last_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_kpis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklists" (
    "id" UUID NOT NULL,
    "kind" "ChecklistKind" NOT NULL,
    "client_id" UUID NOT NULL,
    "accord_id" UUID,
    "charter_id" UUID,
    "project_id" UUID,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "done_at" TIMESTAMP(3),

    CONSTRAINT "checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_items" (
    "id" UUID NOT NULL,
    "checklist_id" UUID NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "label" VARCHAR(255) NOT NULL,
    "group" VARCHAR(20) NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "state" VARCHAR(14) NOT NULL DEFAULT 'missing',
    "verified_by_id" UUID,
    "verified_at" TIMESTAMP(3),
    "evidence" TEXT,

    CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_kpis_client_id_idx" ON "site_kpis"("client_id");

-- CreateIndex
CREATE INDEX "site_kpis_site_id_idx" ON "site_kpis"("site_id");

-- CreateIndex
CREATE INDEX "site_kpis_accord_id_idx" ON "site_kpis"("accord_id");

-- CreateIndex
CREATE INDEX "checklists_client_id_idx" ON "checklists"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_items_checklist_id_key_key" ON "checklist_items"("checklist_id", "key");

-- AddForeignKey
ALTER TABLE "site_kpis" ADD CONSTRAINT "site_kpis_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_kpis" ADD CONSTRAINT "site_kpis_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_kpis" ADD CONSTRAINT "site_kpis_accord_id_fkey" FOREIGN KEY ("accord_id") REFERENCES "accords"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_kpis" ADD CONSTRAINT "site_kpis_charter_id_fkey" FOREIGN KEY ("charter_id") REFERENCES "charters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_accord_id_fkey" FOREIGN KEY ("accord_id") REFERENCES "accords"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_charter_id_fkey" FOREIGN KEY ("charter_id") REFERENCES "charters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_checklist_id_fkey" FOREIGN KEY ("checklist_id") REFERENCES "checklists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

