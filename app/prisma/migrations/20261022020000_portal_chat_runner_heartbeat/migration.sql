-- Portal chat: runner liveness is a heartbeat the runner posts while alive, not a claim (additive).
ALTER TABLE "app_settings" ADD COLUMN     "portal_chat_runner_seen_at" TIMESTAMP(3);
