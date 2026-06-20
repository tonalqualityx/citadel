-- AlterEnum
ALTER TYPE "SiteType" ADD VALUE 'custom';

-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "auto_deploy" BOOLEAN NOT NULL DEFAULT false;
