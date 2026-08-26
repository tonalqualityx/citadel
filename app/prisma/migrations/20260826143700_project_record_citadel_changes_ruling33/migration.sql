-- DropForeignKey
ALTER TABLE "meetings" DROP CONSTRAINT "meetings_client_id_fkey";

-- AlterTable
ALTER TABLE "accords" ADD COLUMN     "pipeline_stage" TEXT,
ADD COLUMN     "pipeline_stage_at" TIMESTAMP(3),
ADD COLUMN     "record_dir" TEXT;

-- AlterTable
ALTER TABLE "meetings" ALTER COLUMN "client_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "scheduled_invoices" (
    "id" UUID NOT NULL,
    "accord_id" UUID NOT NULL,
    "client_id" UUID,
    "project_id" UUID,
    "charter_id" UUID,
    "ware_id" UUID,
    "accord_item_id" UUID,
    "item_kind" TEXT,
    "trigger_type" TEXT NOT NULL,
    "trigger_ref" TEXT,
    "amount_source" TEXT NOT NULL,
    "amount_percent" DECIMAL(6,3),
    "amount_cached" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "due_on" DATE,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notified_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "quickbooks_ref" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_invoices_status_due_on_idx" ON "scheduled_invoices"("status", "due_on");

-- CreateIndex
CREATE INDEX "scheduled_invoices_accord_id_idx" ON "scheduled_invoices"("accord_id");

-- CreateIndex
CREATE INDEX "accords_pipeline_stage_idx" ON "accords"("pipeline_stage");

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_invoices" ADD CONSTRAINT "scheduled_invoices_accord_id_fkey" FOREIGN KEY ("accord_id") REFERENCES "accords"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_invoices" ADD CONSTRAINT "scheduled_invoices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_invoices" ADD CONSTRAINT "scheduled_invoices_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_invoices" ADD CONSTRAINT "scheduled_invoices_charter_id_fkey" FOREIGN KEY ("charter_id") REFERENCES "charters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_invoices" ADD CONSTRAINT "scheduled_invoices_ware_id_fkey" FOREIGN KEY ("ware_id") REFERENCES "wares"("id") ON DELETE SET NULL ON UPDATE CASCADE;
