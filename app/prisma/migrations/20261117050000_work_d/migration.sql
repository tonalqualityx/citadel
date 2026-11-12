-- Work stage D: the linking model (work_link, work_evidence) and a links-only backfill.

-- CreateTable
CREATE TABLE "work_link" (
    "id" UUID NOT NULL,
    "target_key" VARCHAR(60) NOT NULL,
    "project_id" UUID,
    "task_id" UUID,
    "kind" VARCHAR(20) NOT NULL,
    "ref" VARCHAR(300) NOT NULL,
    "label" VARCHAR(300),
    "attached_by" VARCHAR(20) NOT NULL,
    "basis" VARCHAR(40),
    "state" VARCHAR(10) NOT NULL DEFAULT 'active',
    "candidates" JSONB,
    "context" JSONB,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detached_at" TIMESTAMP(3),
    "home_action_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_evidence" (
    "id" UUID NOT NULL,
    "target_key" VARCHAR(60) NOT NULL,
    "project_id" UUID,
    "task_id" UUID,
    "link_id" UUID,
    "kind" VARCHAR(20) NOT NULL,
    "ref" VARCHAR(300) NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "line" VARCHAR(300) NOT NULL,
    "href" VARCHAR(1000),
    "source" VARCHAR(30) NOT NULL,
    "dedupe_key" VARCHAR(400) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_link_kind_ref_state_idx" ON "work_link"("kind", "ref", "state");

-- CreateIndex
CREATE INDEX "work_link_project_id_idx" ON "work_link"("project_id");

-- CreateIndex
CREATE INDEX "work_link_task_id_idx" ON "work_link"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_link_kind_ref_target_key_key" ON "work_link"("kind", "ref", "target_key");

-- CreateIndex
CREATE UNIQUE INDEX "work_evidence_dedupe_key_key" ON "work_evidence"("dedupe_key");

-- CreateIndex
CREATE INDEX "work_evidence_target_key_at_idx" ON "work_evidence"("target_key", "at");

-- DataBackfill 1 of 2: one active email link per conversation, to the task its newest linked ask points at.
-- Links only: no ask, task or project row is read for update, closed, deleted or changed. Idempotent: the unique key (kind, ref,
-- target_key) plus the NOT EXISTS guard mean a second run inserts nothing, and a conversation that already has an active email
-- link (to any target) is left alone, so a conversation never ends with two active targets.
INSERT INTO "work_link" ("id", "target_key", "project_id", "task_id", "kind", "ref", "label", "attached_by", "basis", "state", "first_seen_at", "last_seen_at", "updated_at")
SELECT gen_random_uuid(), 'task:' || n.task_id::text, n.project_id, n.task_id, 'email', n.conversation_key,
       LEFT(COALESCE(NULLIF(BTRIM(n.from_name), ''), n.from_email) || ': ' || n.subject, 300),
       'auto', 'backfill', 'active', n.first_received, n.last_received, CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT ON (a.conversation_key)
         a.conversation_key, a.task_id, t.project_id, a.from_name, a.from_email, a.subject,
         MIN(a.received_at) OVER (PARTITION BY a.conversation_key) AS first_received,
         MAX(a.received_at) OVER (PARTITION BY a.conversation_key) AS last_received
  FROM "email_asks" a
  JOIN "tasks" t ON t.id = a.task_id AND t.is_deleted = false
  WHERE a.task_id IS NOT NULL AND a.conversation_key IS NOT NULL AND a.conversation_key <> '' AND LENGTH(a.conversation_key) <= 300
  ORDER BY a.conversation_key, a.received_at DESC, a.id
) n
WHERE NOT EXISTS (
  SELECT 1 FROM "work_link" w WHERE w."kind" = 'email' AND w."ref" = n.conversation_key AND w."state" = 'active'
);

-- DataBackfill 2 of 2: one active send link per sent outbox row that names a task. Only rows the courier marked sent and that were
-- not dropped. Idempotent through the unique key and the NOT EXISTS guard. The subject is the label; no body or address is copied.
INSERT INTO "work_link" ("id", "target_key", "project_id", "task_id", "kind", "ref", "label", "attached_by", "basis", "state", "first_seen_at", "last_seen_at", "updated_at")
SELECT gen_random_uuid(), 'task:' || o.task_id::text, t.project_id, o.task_id, 'send', o.id::text, LEFT(o.subject, 300),
       'auto', 'backfill', 'active', o.sent_at, o.sent_at, CURRENT_TIMESTAMP
FROM "email_outbox" o
JOIN "tasks" t ON t.id = o.task_id AND t.is_deleted = false
WHERE o.task_id IS NOT NULL AND o.sent_at IS NOT NULL AND o.superseded_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "work_link" w WHERE w."kind" = 'send' AND w."ref" = o.id::text AND w."target_key" = 'task:' || o.task_id::text
  );
