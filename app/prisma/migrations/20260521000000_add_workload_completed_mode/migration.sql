-- CreateEnum
CREATE TYPE "WorkloadCompletedMode" AS ENUM ('low', 'medium', 'high', 'actual');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN "workload_completed_mode" "WorkloadCompletedMode" NOT NULL DEFAULT 'high';
