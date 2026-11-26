-- When a session set its parked question (task 6799e4ca; Mike, 2026-11-26): an ask is dated by this, never by the session's last
-- activity, so an old ask never comes back as new when its session is touched. Additive only.
ALTER TABLE "oracle_sessions" ADD COLUMN "waiting_on_since" TIMESTAMP(3);
