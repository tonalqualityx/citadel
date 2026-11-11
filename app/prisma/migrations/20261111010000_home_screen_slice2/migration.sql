-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "hard_due_at" TIMESTAMP(3),
ADD COLUMN     "hard_due_source" VARCHAR(200);

-- AlterTable
ALTER TABLE "home_item_state" ADD COLUMN     "card_checklist" JSONB,
ADD COLUMN     "card_summary" TEXT,
ADD COLUMN     "card_summary_at" TIMESTAMP(3),
ADD COLUMN     "card_summary_hash" VARCHAR(64),
ADD COLUMN     "dates_read_at" TIMESTAMP(3),
ADD COLUMN     "keeper_hold_until" TIMESTAMP(3),
ADD COLUMN     "read_hard_due_at" TIMESTAMP(3),
ADD COLUMN     "read_hard_due_source" VARCHAR(200),
ADD COLUMN     "view_set_by" VARCHAR(10);

-- CreateTable
CREATE TABLE "home_keeper_runs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" VARCHAR(30) NOT NULL DEFAULT 'nightly',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "counts" JSONB,
    "error" TEXT,

    CONSTRAINT "home_keeper_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_keeper_settings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "arcs_create" BOOLEAN NOT NULL DEFAULT false,
    "arcs_close" BOOLEAN NOT NULL DEFAULT false,
    "arcs_link_tasks" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "home_keeper_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "home_keeper_runs_user_id_date_kind_key" ON "home_keeper_runs"("user_id", "date", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "home_keeper_settings_user_id_key" ON "home_keeper_settings"("user_id");

-- AddForeignKey
ALTER TABLE "home_keeper_runs" ADD CONSTRAINT "home_keeper_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_keeper_settings" ADD CONSTRAINT "home_keeper_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

