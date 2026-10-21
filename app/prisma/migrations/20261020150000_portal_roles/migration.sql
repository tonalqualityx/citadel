-- Client portal MVP A3: client-level role, project visibility, per-project grants, task client_visible.
-- Additive: every new column is defaulted, no existing column changes. Reversible by dropping the
-- new columns/table/enums. The backfill at the bottom runs once, in this migration.

-- CreateEnum
CREATE TYPE "PortalRole" AS ENUM ('owner', 'member', 'viewer', 'none');

-- CreateEnum
CREATE TYPE "PortalVisibility" AS ENUM ('inherit', 'restricted', 'hidden');

-- AlterTable
ALTER TABLE "client_contacts" ADD COLUMN     "portal_role" "PortalRole" NOT NULL DEFAULT 'viewer';

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "portal_visibility" "PortalVisibility" NOT NULL DEFAULT 'inherit';

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "client_visible" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "project_contacts" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "role" "PortalRole" NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_contacts_contact_id_idx" ON "project_contacts"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_contacts_project_id_contact_id_key" ON "project_contacts"("project_id", "contact_id");

-- AddForeignKey
ALTER TABLE "project_contacts" ADD CONSTRAINT "project_contacts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_contacts" ADD CONSTRAINT "project_contacts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "client_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill (spec section 2): primary contacts and anyone who could already initiate work become
-- owner; everyone else stays viewer (the column default). can_initiate_work is then derived from
-- the role (owner/member = true). Note: a primary contact that had can_initiate_work = false
-- becomes true here (the derivation rule); every other contact keeps its current value.
UPDATE "client_contacts" SET "portal_role" = 'owner' WHERE "is_primary" = true OR "can_initiate_work" = true;
UPDATE "client_contacts" SET "can_initiate_work" = ("portal_role" IN ('owner', 'member'));
