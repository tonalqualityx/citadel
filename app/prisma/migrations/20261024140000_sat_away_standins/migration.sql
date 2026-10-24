-- AlterTable
ALTER TABLE "waits" ADD COLUMN     "mike_only" BOOLEAN;

-- CreateTable
CREATE TABLE "away_windows" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "away_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stand_ins" (
    "id" UUID NOT NULL,
    "for_user_id" UUID NOT NULL,
    "role_key" VARCHAR(40) NOT NULL,
    "stand_in_user_id" UUID NOT NULL,

    CONSTRAINT "stand_ins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "away_windows_user_id_starts_at_idx" ON "away_windows"("user_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "stand_ins_for_user_id_role_key_key" ON "stand_ins"("for_user_id", "role_key");

-- AddForeignKey
ALTER TABLE "away_windows" ADD CONSTRAINT "away_windows_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stand_ins" ADD CONSTRAINT "stand_ins_for_user_id_fkey" FOREIGN KEY ("for_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stand_ins" ADD CONSTRAINT "stand_ins_stand_in_user_id_fkey" FOREIGN KEY ("stand_in_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
