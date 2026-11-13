-- CreateEnum
CREATE TYPE "TriageKind" AS ENUM ('project_setup', 'task', 'project_addition', 'reusable_tool', 'rule_proposal', 'question_only');

-- AlterTable
ALTER TABLE "project_phases" ADD COLUMN     "mike_part" VARCHAR(400),
ADD COLUMN     "summary" VARCHAR(400);

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "triage_kind" "TriageKind";
