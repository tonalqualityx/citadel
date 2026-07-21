-- CreateEnum
CREATE TYPE "OracleSessionType" AS ENUM ('client_work', 'internal', 'systems', 'exploratory');

-- CreateEnum
CREATE TYPE "AskQueue" AS ENUM ('decide', 'answer', 'review', 'do');

-- CreateEnum
CREATE TYPE "AskSeverity" AS ENUM ('client_blocking', 'launch_blocking', 'internal');

-- CreateEnum
CREATE TYPE "IdeaSource" AS ENUM ('session', 'oracle', 'email');

-- CreateEnum
CREATE TYPE "IdeaStatus" AS ENUM ('open', 'kept', 'promoted', 'discarded');

-- AlterEnum
ALTER TYPE "TaskSource" ADD VALUE 'session';

-- AlterTable
ALTER TABLE "oracle_sessions" ADD COLUMN     "arc_id" UUID,
ADD COLUMN     "archived_at" TIMESTAMP(3),
ADD COLUMN     "ask_queue" "AskQueue",
ADD COLUMN     "ask_severity" "AskSeverity",
ADD COLUMN     "goal" TEXT,
ADD COLUMN     "session_type" "OracleSessionType",
ADD COLUMN     "waiting_on" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "arc_id" UUID,
ADD COLUMN     "origin_url" VARCHAR(1000),
ADD COLUMN     "source_session_external_id" VARCHAR(255);

-- CreateTable
CREATE TABLE "arcs" (
    "id" UUID NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "description" TEXT,
    "client_id" UUID,
    "project_id" UUID,
    "origin_session_external_id" VARCHAR(255),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "arcs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ideas" (
    "id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "source" "IdeaSource" NOT NULL,
    "source_ref" VARCHAR(500),
    "status" "IdeaStatus" NOT NULL DEFAULT 'open',
    "promoted_task_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ideas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "arcs_project_id_idx" ON "arcs"("project_id");

-- CreateIndex
CREATE INDEX "arcs_client_id_idx" ON "arcs"("client_id");

-- CreateIndex
CREATE INDEX "ideas_status_idx" ON "ideas"("status");

-- CreateIndex
CREATE INDEX "oracle_sessions_archived_at_idx" ON "oracle_sessions"("archived_at");

-- CreateIndex
CREATE INDEX "oracle_sessions_arc_id_idx" ON "oracle_sessions"("arc_id");

-- CreateIndex
CREATE INDEX "tasks_arc_id_idx" ON "tasks"("arc_id");

-- CreateIndex
CREATE INDEX "tasks_source_session_external_id_idx" ON "tasks"("source_session_external_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_arc_id_fkey" FOREIGN KEY ("arc_id") REFERENCES "arcs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_sessions" ADD CONSTRAINT "oracle_sessions_arc_id_fkey" FOREIGN KEY ("arc_id") REFERENCES "arcs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arcs" ADD CONSTRAINT "arcs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arcs" ADD CONSTRAINT "arcs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_promoted_task_id_fkey" FOREIGN KEY ("promoted_task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
