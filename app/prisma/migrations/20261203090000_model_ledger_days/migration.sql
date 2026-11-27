-- The model ledger's daily rollup (task ab418893; Mike, 2026-11-27): one row per day, model and task type, pushed by the
-- Bast machine. Additive only.
CREATE TABLE "model_ledger_days" (
    "id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "model" VARCHAR(20) NOT NULL,
    "task_type" VARCHAR(60) NOT NULL,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "cards" INTEGER NOT NULL DEFAULT 0,
    "finished" INTEGER NOT NULL DEFAULT 0,
    "first_try" INTEGER NOT NULL DEFAULT 0,
    "escalations" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "unpriced_runs" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_ledger_days_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "model_ledger_days_day_model_task_type_key" ON "model_ledger_days"("day", "model", "task_type");
CREATE INDEX "model_ledger_days_day_idx" ON "model_ledger_days"("day");
