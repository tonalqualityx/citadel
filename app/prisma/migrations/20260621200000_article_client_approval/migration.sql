-- Client approval on articles (parallel to tasks). Clients are not Users — approval is by
-- ClientContact. Additive, nullable columns + index + nullable FK — reversible, no data loss.

-- AlterTable
ALTER TABLE "troubador_articles" ADD COLUMN     "approved_by_contact_id" UUID,
ADD COLUMN     "client_approved_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "troubador_articles_approved_by_contact_id_idx" ON "troubador_articles"("approved_by_contact_id");

-- AddForeignKey
ALTER TABLE "troubador_articles" ADD CONSTRAINT "troubador_articles_approved_by_contact_id_fkey" FOREIGN KEY ("approved_by_contact_id") REFERENCES "client_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
