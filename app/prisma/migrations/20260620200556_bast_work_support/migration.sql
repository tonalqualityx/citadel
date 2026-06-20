-- CreateEnum
CREATE TYPE "TaskSource" AS ENUM ('portal', 'email', 'internal');

-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "bast_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "prod_branch" VARCHAR(100),
ADD COLUMN     "staging_auth_password" VARCHAR(255),
ADD COLUMN     "staging_auth_user" VARCHAR(255),
ADD COLUMN     "staging_branch" VARCHAR(100),
ADD COLUMN     "staging_url" VARCHAR(500);

-- AlterTable
ALTER TABLE "sops" ADD COLUMN     "bast_executable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "approved_by_contact_id" UUID,
ADD COLUMN     "client_approved_at" TIMESTAMP(3),
ADD COLUMN     "requested_by_contact_id" UUID,
ADD COLUMN     "source" "TaskSource" NOT NULL DEFAULT 'internal',
ADD COLUMN     "source_ref" VARCHAR(255),
ADD COLUMN     "staging_deployed_at" TIMESTAMP(3),
ADD COLUMN     "staging_preview_url" VARCHAR(500),
ADD COLUMN     "tags" VARCHAR(50)[] DEFAULT ARRAY[]::VARCHAR(50)[];

-- CreateIndex
CREATE INDEX "tasks_source_idx" ON "tasks"("source");

-- CreateIndex
CREATE INDEX "tasks_requested_by_contact_id_idx" ON "tasks"("requested_by_contact_id");

-- CreateIndex
CREATE INDEX "tasks_approved_by_contact_id_idx" ON "tasks"("approved_by_contact_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_requested_by_contact_id_fkey" FOREIGN KEY ("requested_by_contact_id") REFERENCES "client_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_approved_by_contact_id_fkey" FOREIGN KEY ("approved_by_contact_id") REFERENCES "client_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
