-- AlterEnum
ALTER TYPE "SiteType" ADD VALUE 'handoff';

-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "handoff_method" VARCHAR(50),
ADD COLUMN     "handoff_recipient" VARCHAR(255);

