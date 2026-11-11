-- Home screen Slice 8b: project next steps as rows. Two nullable columns only. No ALTER TYPE.

-- AlterTable
ALTER TABLE "home_item_state" ADD COLUMN "step_done_at" TIMESTAMP(3),
ADD COLUMN "step_done_text" TEXT;
