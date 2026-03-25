/*
  Warnings:

  - You are about to drop the column `meeting_date` on the `accords` table. All the data in the column will be lost.
  - You are about to drop the column `meeting_notes` on the `accords` table. All the data in the column will be lost.
  - You are about to drop the column `meeting_recording_url` on the `accords` table. All the data in the column will be lost.
  - You are about to drop the column `meeting_transcript_url` on the `accords` table. All the data in the column will be lost.
  - You are about to drop the `accord_meeting_attendees` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "accord_meeting_attendees" DROP CONSTRAINT "accord_meeting_attendees_accord_id_fkey";

-- DropForeignKey
ALTER TABLE "accord_meeting_attendees" DROP CONSTRAINT "accord_meeting_attendees_user_id_fkey";

-- AlterTable
ALTER TABLE "accords" DROP COLUMN "meeting_date",
DROP COLUMN "meeting_notes",
DROP COLUMN "meeting_recording_url",
DROP COLUMN "meeting_transcript_url";

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "meeting_id" UUID;

-- DropTable
DROP TABLE "accord_meeting_attendees";

-- CreateTable
CREATE TABLE "meetings" (
    "id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "client_id" UUID NOT NULL,
    "meeting_date" TIMESTAMP(3) NOT NULL,
    "summary" TEXT,
    "notes" TEXT,
    "transcript_url" VARCHAR(500),
    "recording_url" VARCHAR(500),
    "client_attendees" TEXT,
    "transcript_not_available" BOOLEAN NOT NULL DEFAULT false,
    "recording_not_available" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_attendees" (
    "id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_accords" (
    "id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "accord_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_accords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_projects" (
    "id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_charters" (
    "id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "charter_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_charters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meetings_client_id_idx" ON "meetings"("client_id");

-- CreateIndex
CREATE INDEX "meetings_meeting_date_idx" ON "meetings"("meeting_date");

-- CreateIndex
CREATE INDEX "meetings_created_by_id_idx" ON "meetings"("created_by_id");

-- CreateIndex
CREATE INDEX "meeting_attendees_meeting_id_idx" ON "meeting_attendees"("meeting_id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_attendees_meeting_id_user_id_key" ON "meeting_attendees"("meeting_id", "user_id");

-- CreateIndex
CREATE INDEX "meeting_accords_meeting_id_idx" ON "meeting_accords"("meeting_id");

-- CreateIndex
CREATE INDEX "meeting_accords_accord_id_idx" ON "meeting_accords"("accord_id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_accords_meeting_id_accord_id_key" ON "meeting_accords"("meeting_id", "accord_id");

-- CreateIndex
CREATE INDEX "meeting_projects_meeting_id_idx" ON "meeting_projects"("meeting_id");

-- CreateIndex
CREATE INDEX "meeting_projects_project_id_idx" ON "meeting_projects"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_projects_meeting_id_project_id_key" ON "meeting_projects"("meeting_id", "project_id");

-- CreateIndex
CREATE INDEX "meeting_charters_meeting_id_idx" ON "meeting_charters"("meeting_id");

-- CreateIndex
CREATE INDEX "meeting_charters_charter_id_idx" ON "meeting_charters"("charter_id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_charters_meeting_id_charter_id_key" ON "meeting_charters"("meeting_id", "charter_id");

-- CreateIndex
CREATE INDEX "tasks_meeting_id_idx" ON "tasks"("meeting_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_accords" ADD CONSTRAINT "meeting_accords_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_accords" ADD CONSTRAINT "meeting_accords_accord_id_fkey" FOREIGN KEY ("accord_id") REFERENCES "accords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_projects" ADD CONSTRAINT "meeting_projects_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_projects" ADD CONSTRAINT "meeting_projects_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_charters" ADD CONSTRAINT "meeting_charters_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_charters" ADD CONSTRAINT "meeting_charters_charter_id_fkey" FOREIGN KEY ("charter_id") REFERENCES "charters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
