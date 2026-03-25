-- AlterTable
ALTER TABLE "charters" ADD COLUMN     "duration_months" INTEGER,
ADD COLUMN     "renewal_date" DATE,
ADD COLUMN     "site_id" UUID;

-- AlterTable
ALTER TABLE "wares" ADD COLUMN     "default_duration_months" INTEGER,
ADD COLUMN     "renewal_lead_time_days" INTEGER;

-- CreateTable
CREATE TABLE "accord_charter_items" (
    "id" UUID NOT NULL,
    "accord_id" UUID NOT NULL,
    "ware_id" UUID NOT NULL,
    "name_override" VARCHAR(255),
    "price_tier" VARCHAR(100),
    "base_price" DECIMAL(10,2) NOT NULL,
    "discount_type" VARCHAR(10),
    "discount_value" DECIMAL(10,2),
    "final_price" DECIMAL(10,2) NOT NULL,
    "billing_period" "CharterBillingPeriod" NOT NULL,
    "duration_months" INTEGER NOT NULL,
    "total_contract_value" DECIMAL(10,2) NOT NULL,
    "charter_id" UUID,
    "contract_language_override" TEXT,
    "addendum_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accord_charter_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accord_commission_items" (
    "id" UUID NOT NULL,
    "accord_id" UUID NOT NULL,
    "ware_id" UUID NOT NULL,
    "name_override" VARCHAR(255),
    "estimated_price" DECIMAL(10,2),
    "project_id" UUID,
    "discount_type" VARCHAR(10),
    "discount_value" DECIMAL(10,2),
    "final_price" DECIMAL(10,2),
    "contract_language_override" TEXT,
    "addendum_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accord_commission_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accord_keep_items" (
    "id" UUID NOT NULL,
    "accord_id" UUID NOT NULL,
    "site_id" UUID,
    "site_name_placeholder" VARCHAR(255),
    "domain_name" VARCHAR(255),
    "hosting_plan_id" UUID,
    "maintenance_plan_id" UUID,
    "hosting_price" DECIMAL(10,2),
    "hosting_discount_type" VARCHAR(10),
    "hosting_discount_value" DECIMAL(10,2),
    "hosting_final_price" DECIMAL(10,2),
    "maintenance_price" DECIMAL(10,2),
    "maintenance_discount_type" VARCHAR(10),
    "maintenance_discount_value" DECIMAL(10,2),
    "maintenance_final_price" DECIMAL(10,2),
    "monthly_total" DECIMAL(10,2),
    "is_client_hosted" BOOLEAN NOT NULL DEFAULT false,
    "contract_language_override" TEXT,
    "addendum_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accord_keep_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charter_renewal_logs" (
    "id" UUID NOT NULL,
    "charter_id" UUID NOT NULL,
    "renewal_date" DATE NOT NULL,
    "task_id" UUID,
    "accord_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "charter_renewal_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accord_charter_items_accord_id_idx" ON "accord_charter_items"("accord_id");

-- CreateIndex
CREATE INDEX "accord_charter_items_ware_id_idx" ON "accord_charter_items"("ware_id");

-- CreateIndex
CREATE INDEX "accord_charter_items_charter_id_idx" ON "accord_charter_items"("charter_id");

-- CreateIndex
CREATE INDEX "accord_charter_items_addendum_id_idx" ON "accord_charter_items"("addendum_id");

-- CreateIndex
CREATE INDEX "accord_commission_items_accord_id_idx" ON "accord_commission_items"("accord_id");

-- CreateIndex
CREATE INDEX "accord_commission_items_ware_id_idx" ON "accord_commission_items"("ware_id");

-- CreateIndex
CREATE INDEX "accord_commission_items_project_id_idx" ON "accord_commission_items"("project_id");

-- CreateIndex
CREATE INDEX "accord_commission_items_addendum_id_idx" ON "accord_commission_items"("addendum_id");

-- CreateIndex
CREATE INDEX "accord_keep_items_accord_id_idx" ON "accord_keep_items"("accord_id");

-- CreateIndex
CREATE INDEX "accord_keep_items_site_id_idx" ON "accord_keep_items"("site_id");

-- CreateIndex
CREATE INDEX "accord_keep_items_hosting_plan_id_idx" ON "accord_keep_items"("hosting_plan_id");

-- CreateIndex
CREATE INDEX "accord_keep_items_maintenance_plan_id_idx" ON "accord_keep_items"("maintenance_plan_id");

-- CreateIndex
CREATE INDEX "accord_keep_items_addendum_id_idx" ON "accord_keep_items"("addendum_id");

-- CreateIndex
CREATE INDEX "charter_renewal_logs_charter_id_idx" ON "charter_renewal_logs"("charter_id");

-- CreateIndex
CREATE INDEX "charter_renewal_logs_accord_id_idx" ON "charter_renewal_logs"("accord_id");

-- CreateIndex
CREATE UNIQUE INDEX "charter_renewal_logs_charter_id_renewal_date_key" ON "charter_renewal_logs"("charter_id", "renewal_date");

-- CreateIndex
CREATE INDEX "charters_site_id_idx" ON "charters"("site_id");

-- AddForeignKey
ALTER TABLE "accord_charter_items" ADD CONSTRAINT "accord_charter_items_accord_id_fkey" FOREIGN KEY ("accord_id") REFERENCES "accords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accord_charter_items" ADD CONSTRAINT "accord_charter_items_ware_id_fkey" FOREIGN KEY ("ware_id") REFERENCES "wares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accord_charter_items" ADD CONSTRAINT "accord_charter_items_charter_id_fkey" FOREIGN KEY ("charter_id") REFERENCES "charters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accord_charter_items" ADD CONSTRAINT "accord_charter_items_addendum_id_fkey" FOREIGN KEY ("addendum_id") REFERENCES "addendums"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accord_commission_items" ADD CONSTRAINT "accord_commission_items_accord_id_fkey" FOREIGN KEY ("accord_id") REFERENCES "accords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accord_commission_items" ADD CONSTRAINT "accord_commission_items_ware_id_fkey" FOREIGN KEY ("ware_id") REFERENCES "wares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accord_commission_items" ADD CONSTRAINT "accord_commission_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accord_commission_items" ADD CONSTRAINT "accord_commission_items_addendum_id_fkey" FOREIGN KEY ("addendum_id") REFERENCES "addendums"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accord_keep_items" ADD CONSTRAINT "accord_keep_items_accord_id_fkey" FOREIGN KEY ("accord_id") REFERENCES "accords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accord_keep_items" ADD CONSTRAINT "accord_keep_items_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accord_keep_items" ADD CONSTRAINT "accord_keep_items_hosting_plan_id_fkey" FOREIGN KEY ("hosting_plan_id") REFERENCES "hosting_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accord_keep_items" ADD CONSTRAINT "accord_keep_items_maintenance_plan_id_fkey" FOREIGN KEY ("maintenance_plan_id") REFERENCES "maintenance_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accord_keep_items" ADD CONSTRAINT "accord_keep_items_addendum_id_fkey" FOREIGN KEY ("addendum_id") REFERENCES "addendums"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charter_renewal_logs" ADD CONSTRAINT "charter_renewal_logs_charter_id_fkey" FOREIGN KEY ("charter_id") REFERENCES "charters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charter_renewal_logs" ADD CONSTRAINT "charter_renewal_logs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charter_renewal_logs" ADD CONSTRAINT "charter_renewal_logs_accord_id_fkey" FOREIGN KEY ("accord_id") REFERENCES "accords"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charters" ADD CONSTRAINT "charters_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
