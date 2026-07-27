-- CreateEnum
CREATE TYPE "TodayViewLens" AS ENUM ('list', 'board');

-- AlterTable
ALTER TABLE "user_preferences" ADD COLUMN     "today_view" "TodayViewLens" NOT NULL DEFAULT 'list';
