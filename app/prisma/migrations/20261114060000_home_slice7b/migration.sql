-- Home screen Slice 7b: learned weights. One new table and one defaulted column. No ALTER TYPE.

-- AlterTable
ALTER TABLE "home_keeper_settings" ADD COLUMN "learn_weights" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "home_score_weights" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "evidence_key" VARCHAR(200) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "weight_pct" INTEGER NOT NULL DEFAULT 100,
    "signals_up" INTEGER NOT NULL DEFAULT 0,
    "signals_down" INTEGER NOT NULL DEFAULT 0,
    "changed_at" TIMESTAMP(3),
    "changed_by_action_id" UUID,
    "held_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "home_score_weights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "home_score_weights_user_id_evidence_key_key" ON "home_score_weights"("user_id", "evidence_key");

-- AddForeignKey
ALTER TABLE "home_score_weights" ADD CONSTRAINT "home_score_weights_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
