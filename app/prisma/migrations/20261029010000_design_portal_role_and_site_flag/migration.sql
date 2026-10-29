-- Designer portal: enum values and Site flags. Kept in their own migration so the new enum
-- values are committed before the next migration uses them.

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'designer';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'design_published';
ALTER TYPE "NotificationType" ADD VALUE 'design_publish_requested';
ALTER TYPE "NotificationType" ADD VALUE 'design_rolled_back';

-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "design_portal_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "designer_publish" BOOLEAN NOT NULL DEFAULT true;
