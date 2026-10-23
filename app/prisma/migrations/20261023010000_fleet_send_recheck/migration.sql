-- Fleet item 4: send-time recheck. Additive only (nullable columns, columns with defaults).
ALTER TABLE "email_outbox" ADD COLUMN     "govern" JSONB,
ADD COLUMN     "superseded_at" TIMESTAMP(3),
ADD COLUMN     "superseded_reason" VARCHAR(64);

ALTER TABLE "approval_requests" ADD COLUMN     "superseded_at" TIMESTAMP(3),
ADD COLUMN     "superseded_reason" VARCHAR(64);

ALTER TABLE "app_settings" ADD COLUMN     "send_recheck_mode" VARCHAR(10) NOT NULL DEFAULT 'enforce',
ADD COLUMN     "send_recheck_heuristics" VARCHAR(10) NOT NULL DEFAULT 'shadow';
