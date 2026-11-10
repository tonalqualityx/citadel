-- Home screen Slice 1 (specs/home-build-plan.md): per-user first-screen switch, item state, day proposal, action log.
-- Additive only: one enum, three tables, indexes, foreign keys, one defaulted column on user_preferences.
-- CreateEnum
CREATE TYPE "HomeView" AS ENUM ('overlook', 'home');

-- AlterTable
ALTER TABLE "user_preferences" ADD COLUMN     "home_view" "HomeView" NOT NULL DEFAULT 'overlook';

-- CreateTable
CREATE TABLE "home_item_state" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "item_key" VARCHAR(300) NOT NULL,
    "park_count" INTEGER NOT NULL DEFAULT 0,
    "view_at" TIMESTAMP(3),
    "boosted_at" TIMESTAMP(3),
    "not_emergency_at" TIMESTAMP(3),
    "working_since" TIMESTAMP(3),
    "left_off_note" TEXT,
    "arc_added_at" TIMESTAMP(3),
    "arc_added_group" VARCHAR(120),
    "arc_removed_at" TIMESTAMP(3),
    "arc_removed_group" VARCHAR(120),
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_shown_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "home_item_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_day" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "group_key" VARCHAR(120) NOT NULL,
    "group_label" VARCHAR(300) NOT NULL,
    "arc_id" UUID,
    "quick_item_keys" VARCHAR(300)[] DEFAULT ARRAY[]::VARCHAR(300)[],
    "step_item_keys" VARCHAR(300)[] DEFAULT ARRAY[]::VARCHAR(300)[],
    "sized_minutes" INTEGER,
    "proposed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "swapped_from_group" VARCHAR(120),
    "lighter_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "home_day_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_actions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "item_key" VARCHAR(300),
    "action" VARCHAR(60) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "undo_until" TIMESTAMP(3),
    "undone_at" TIMESTAMP(3),
    "source" VARCHAR(30) NOT NULL DEFAULT 'home',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "home_item_state_user_id_view_at_idx" ON "home_item_state"("user_id", "view_at");

-- CreateIndex
CREATE UNIQUE INDEX "home_item_state_user_id_item_key_key" ON "home_item_state"("user_id", "item_key");

-- CreateIndex
CREATE UNIQUE INDEX "home_day_user_id_date_key" ON "home_day"("user_id", "date");

-- CreateIndex
CREATE INDEX "home_actions_user_id_created_at_idx" ON "home_actions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "home_actions_user_id_item_key_idx" ON "home_actions"("user_id", "item_key");

-- AddForeignKey
ALTER TABLE "home_item_state" ADD CONSTRAINT "home_item_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_day" ADD CONSTRAINT "home_day_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_actions" ADD CONSTRAINT "home_actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

