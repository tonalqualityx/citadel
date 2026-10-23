-- Fleet item 3: atomic task claims with leases. Additive only.
ALTER TABLE "tasks" ADD COLUMN "claim_holder" VARCHAR(200),
ADD COLUMN "claim_token" UUID,
ADD COLUMN "claimed_at" TIMESTAMP(3),
ADD COLUMN "lease_until" TIMESTAMP(3);

ALTER TABLE "app_settings" ADD COLUMN "task_claims_mode" TEXT NOT NULL DEFAULT 'warn';

CREATE INDEX "tasks_lease_until_idx" ON "tasks"("lease_until");
