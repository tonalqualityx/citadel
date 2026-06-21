-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "mentioned_user_ids" UUID[] DEFAULT ARRAY[]::UUID[];
