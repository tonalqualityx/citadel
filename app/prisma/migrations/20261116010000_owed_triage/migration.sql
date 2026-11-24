-- Owed-reply triage: a thread is owed only after a verdict says a reply from him is needed.
-- Nullable columns only; no data is changed and no enum is altered.
ALTER TABLE "home_owed_thread"
  ADD COLUMN "triage" VARCHAR(20),
  ADD COLUMN "triage_confidence" VARCHAR(10),
  ADD COLUMN "triage_reason" VARCHAR(200),
  ADD COLUMN "triage_for_ask_id" UUID,
  ADD COLUMN "triaged_at" TIMESTAMP(3),
  ADD COLUMN "triage_hold_until" TIMESTAMP(3);
