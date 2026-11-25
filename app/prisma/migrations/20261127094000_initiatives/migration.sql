-- Initiatives (design.md 2.1 to 2.3): the record, its one to three numbers, readings, check-ins, and an optional link
-- from a project or task. Additive only: new enums, new tables, two nullable columns. Nothing dropped.

-- CreateEnum
CREATE TYPE "InitiativeStatus" AS ENUM ('proposed', 'active', 'paused', 'done', 'stopped');

-- CreateEnum
CREATE TYPE "InitiativeHealth" AS ENUM ('on_track', 'behind', 'unchecked');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "initiative_id" UUID;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "initiative_id" UUID;

-- CreateTable
CREATE TABLE "initiatives" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "bet" TEXT NOT NULL,
    "nightmare" TEXT,
    "prevention" TEXT,
    "repair" TEXT,
    "cost_of_waiting" TEXT,
    "stop_condition" TEXT,
    "check_date" DATE,
    "check_every_days" INTEGER,
    "next_decision" VARCHAR(300),
    "status" "InitiativeStatus" NOT NULL DEFAULT 'proposed',
    "health" "InitiativeHealth" NOT NULL DEFAULT 'unchecked',
    "health_reason" VARCHAR(200),
    "owner_id" UUID NOT NULL,
    "client_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "activated_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "closed_reason" TEXT,
    "created_by_id" UUID NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "initiatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "initiative_numbers" (
    "id" UUID NOT NULL,
    "initiative_id" UUID NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "unit" VARCHAR(12) NOT NULL,
    "direction" VARCHAR(4) NOT NULL,
    "baseline_value" DECIMAL(14,2),
    "baseline_at" TIMESTAMP(3),
    "target_value" DECIMAL(14,2) NOT NULL,
    "target_by" DATE NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "last_value" DECIMAL(14,2),
    "last_read_at" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "initiative_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "initiative_readings" (
    "id" UUID NOT NULL,
    "number_id" UUID NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" VARCHAR(40) NOT NULL,

    CONSTRAINT "initiative_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "initiative_check_ins" (
    "id" UUID NOT NULL,
    "initiative_id" UUID NOT NULL,
    "health" "InitiativeHealth" NOT NULL,
    "note" VARCHAR(300),
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "initiative_check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "initiatives_status_idx" ON "initiatives"("status");

-- CreateIndex
CREATE INDEX "initiative_numbers_initiative_id_idx" ON "initiative_numbers"("initiative_id");

-- CreateIndex
CREATE INDEX "initiative_readings_number_id_read_at_idx" ON "initiative_readings"("number_id", "read_at");

-- CreateIndex
CREATE INDEX "initiative_check_ins_initiative_id_created_at_idx" ON "initiative_check_ins"("initiative_id", "created_at");

-- CreateIndex
CREATE INDEX "projects_initiative_id_idx" ON "projects"("initiative_id");

-- CreateIndex
CREATE INDEX "tasks_initiative_id_idx" ON "tasks"("initiative_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_initiative_id_fkey" FOREIGN KEY ("initiative_id") REFERENCES "initiatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_initiative_id_fkey" FOREIGN KEY ("initiative_id") REFERENCES "initiatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "initiative_numbers" ADD CONSTRAINT "initiative_numbers_initiative_id_fkey" FOREIGN KEY ("initiative_id") REFERENCES "initiatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "initiative_readings" ADD CONSTRAINT "initiative_readings_number_id_fkey" FOREIGN KEY ("number_id") REFERENCES "initiative_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "initiative_check_ins" ADD CONSTRAINT "initiative_check_ins_initiative_id_fkey" FOREIGN KEY ("initiative_id") REFERENCES "initiatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "initiative_check_ins" ADD CONSTRAINT "initiative_check_ins_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
