-- CreateTable
CREATE TABLE "work_finished_item" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "run_key" VARCHAR(40) NOT NULL,
    "task_id" UUID NOT NULL,
    "grp" VARCHAR(20) NOT NULL,
    "strength" VARCHAR(8) NOT NULL,
    "evidence" JSONB NOT NULL,
    "state" VARCHAR(10) NOT NULL DEFAULT 'open',
    "home_action_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "work_finished_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_finished_item_user_id_state_idx" ON "work_finished_item"("user_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "work_finished_item_user_id_run_key_task_id_key" ON "work_finished_item"("user_id", "run_key", "task_id");

-- AddForeignKey
ALTER TABLE "work_finished_item" ADD CONSTRAINT "work_finished_item_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

