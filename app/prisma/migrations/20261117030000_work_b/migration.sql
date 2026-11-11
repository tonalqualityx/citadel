-- Work stage B (one intake decision per message): the decision on email asks. Nullable columns and an index only, no ALTER TYPE.
ALTER TABLE "email_asks" ADD COLUMN "disposition" VARCHAR(20),
ADD COLUMN "disposition_reason" VARCHAR(200),
ADD COLUMN "owner" VARCHAR(10),
ADD COLUMN "decided_by" VARCHAR(20);

-- CreateIndex
CREATE INDEX "email_asks_disposition_idx" ON "email_asks"("disposition");
