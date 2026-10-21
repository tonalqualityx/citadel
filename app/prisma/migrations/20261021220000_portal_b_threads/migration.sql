-- CreateEnum
CREATE TYPE "PortalNoticeStatus" AS ENUM ('queued', 'sending', 'sent', 'failed', 'cancelled');

-- AlterTable
ALTER TABLE "charters" ADD COLUMN     "client_label" VARCHAR(255);

-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "author_contact_id" UUID,
ADD COLUMN     "client_ref" VARCHAR(64),
ADD COLUMN     "client_visible" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "portal_notices" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "comment_ids" UUID[],
    "to_email" VARCHAR(255) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "status" "PortalNoticeStatus" NOT NULL DEFAULT 'queued',
    "send_attempt_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "message_id" VARCHAR(255),
    "thread_id" VARCHAR(255),
    "send_error" TEXT,
    "send_error_count" INTEGER NOT NULL DEFAULT 0,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_reports" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "charter_id" UUID,
    "site_id" UUID,
    "period" VARCHAR(7) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "headline" TEXT,
    "url" VARCHAR(500) NOT NULL,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portal_notices_status_created_at_idx" ON "portal_notices"("status", "created_at");

-- CreateIndex
CREATE INDEX "portal_notices_task_id_contact_id_status_idx" ON "portal_notices"("task_id", "contact_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "client_reports_url_key" ON "client_reports"("url");

-- CreateIndex
CREATE INDEX "client_reports_client_id_published_at_idx" ON "client_reports"("client_id", "published_at");

-- CreateIndex
CREATE INDEX "client_reports_charter_id_idx" ON "client_reports"("charter_id");

-- CreateIndex
CREATE UNIQUE INDEX "comments_client_ref_key" ON "comments"("client_ref");

-- CreateIndex
CREATE INDEX "comments_task_id_client_visible_idx" ON "comments"("task_id", "client_visible");

-- CreateIndex
CREATE INDEX "comments_author_contact_id_idx" ON "comments"("author_contact_id");

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_contact_id_fkey" FOREIGN KEY ("author_contact_id") REFERENCES "client_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_notices" ADD CONSTRAINT "portal_notices_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_notices" ADD CONSTRAINT "portal_notices_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "client_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_reports" ADD CONSTRAINT "client_reports_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_reports" ADD CONSTRAINT "client_reports_charter_id_fkey" FOREIGN KEY ("charter_id") REFERENCES "charters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_reports" ADD CONSTRAINT "client_reports_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

