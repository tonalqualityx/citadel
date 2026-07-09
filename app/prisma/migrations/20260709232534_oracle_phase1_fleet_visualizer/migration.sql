-- CreateEnum
CREATE TYPE "OracleSource" AS ENUM ('claude_code', 'workflow', 'openclaw_cron');

-- CreateEnum
CREATE TYPE "OracleSessionStatus" AS ENUM ('running', 'waiting', 'ended', 'stale');

-- CreateTable
CREATE TABLE "oracle_machines" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "hostname" VARCHAR(255),
    "last_heartbeat_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oracle_machines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oracle_sessions" (
    "id" UUID NOT NULL,
    "machine_id" UUID NOT NULL,
    "external_id" VARCHAR(255) NOT NULL,
    "source" "OracleSource" NOT NULL,
    "title" VARCHAR(500),
    "cwd" VARCHAR(1000),
    "model" VARCHAR(100),
    "status" "OracleSessionStatus" NOT NULL DEFAULT 'running',
    "needs_attention" BOOLEAN NOT NULL DEFAULT false,
    "attention_reason" TEXT,
    "started_at" TIMESTAMP(3),
    "last_event_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "tokens_total" INTEGER NOT NULL DEFAULT 0,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oracle_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oracle_agents" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "external_id" VARCHAR(255) NOT NULL,
    "label" VARCHAR(255) NOT NULL,
    "phase" VARCHAR(100),
    "model" VARCHAR(100),
    "status" VARCHAR(50) NOT NULL DEFAULT 'queued',
    "activity" TEXT,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oracle_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oracle_events" (
    "id" UUID NOT NULL,
    "session_id" UUID,
    "machine_id" UUID NOT NULL,
    "kind" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oracle_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oracle_machines_name_key" ON "oracle_machines"("name");

-- CreateIndex
CREATE INDEX "oracle_sessions_machine_id_idx" ON "oracle_sessions"("machine_id");

-- CreateIndex
CREATE INDEX "oracle_sessions_status_idx" ON "oracle_sessions"("status");

-- CreateIndex
CREATE INDEX "oracle_sessions_last_event_at_idx" ON "oracle_sessions"("last_event_at");

-- CreateIndex
CREATE UNIQUE INDEX "oracle_sessions_machine_id_source_external_id_key" ON "oracle_sessions"("machine_id", "source", "external_id");

-- CreateIndex
CREATE INDEX "oracle_agents_session_id_idx" ON "oracle_agents"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "oracle_agents_session_id_external_id_key" ON "oracle_agents"("session_id", "external_id");

-- CreateIndex
CREATE INDEX "oracle_events_machine_id_ts_idx" ON "oracle_events"("machine_id", "ts");

-- CreateIndex
CREATE INDEX "oracle_events_session_id_idx" ON "oracle_events"("session_id");

-- AddForeignKey
ALTER TABLE "oracle_sessions" ADD CONSTRAINT "oracle_sessions_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "oracle_machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_agents" ADD CONSTRAINT "oracle_agents_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "oracle_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_events" ADD CONSTRAINT "oracle_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "oracle_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_events" ADD CONSTRAINT "oracle_events_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "oracle_machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
