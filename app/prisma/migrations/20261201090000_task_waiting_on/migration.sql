-- Waiting on someone (task 23cd54cf; Mike, 2026-11-26): a card can be marked waiting on a named person with a follow-up
-- date, and it leaves Mike's waiting lists until that person answers or the date passes. Additive only.
ALTER TABLE "tasks" ADD COLUMN "waiting_on_name" VARCHAR(200);
ALTER TABLE "tasks" ADD COLUMN "waiting_on_contact_id" UUID;
ALTER TABLE "tasks" ADD COLUMN "waiting_on_user_id" UUID;
ALTER TABLE "tasks" ADD COLUMN "waiting_since" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "waiting_follow_up_at" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "waiting_thread" VARCHAR(300);
ALTER TABLE "tasks" ADD COLUMN "waiting_note" VARCHAR(500);
ALTER TABLE "tasks" ADD COLUMN "waiting_follow_up_sent_at" TIMESTAMP(3);

CREATE INDEX "tasks_waiting_since_idx" ON "tasks"("waiting_since");
CREATE INDEX "tasks_waiting_on_contact_id_idx" ON "tasks"("waiting_on_contact_id");

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_waiting_on_contact_id_fkey" FOREIGN KEY ("waiting_on_contact_id") REFERENCES "client_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_waiting_on_user_id_fkey" FOREIGN KEY ("waiting_on_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
