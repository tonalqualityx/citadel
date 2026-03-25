-- CreateTable
CREATE TABLE "sales_automation_logs" (
    "id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "accord_id" UUID NOT NULL,
    "task_id" UUID,
    "fired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_automation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_automation_logs_accord_id_idx" ON "sales_automation_logs"("accord_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_automation_logs_rule_id_accord_id_key" ON "sales_automation_logs"("rule_id", "accord_id");

-- AddForeignKey
ALTER TABLE "sales_automation_logs" ADD CONSTRAINT "sales_automation_logs_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "sales_automation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_automation_logs" ADD CONSTRAINT "sales_automation_logs_accord_id_fkey" FOREIGN KEY ("accord_id") REFERENCES "accords"("id") ON DELETE CASCADE ON UPDATE CASCADE;
