-- CreateEnum
CREATE TYPE "DecisionKind" AS ENUM ('ruling', 'client_decision', 'policy');

-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('proposed', 'recorded_from_source', 'confirmed', 'superseded', 'retracted', 'rejected');

-- CreateEnum
CREATE TYPE "DecisionScope" AS ENUM ('fleet', 'lane', 'client', 'project', 'charter', 'site', 'accord');

-- CreateEnum
CREATE TYPE "DecisionSourceKind" AS ENUM ('session', 'transcript', 'email', 'doc', 'memory', 'portal');

-- CreateTable
CREATE TABLE "decisions" (
    "id" UUID NOT NULL,
    "key" VARCHAR(200),
    "title" VARCHAR(300) NOT NULL,
    "text" TEXT NOT NULL,
    "kind" "DecisionKind" NOT NULL DEFAULT 'ruling',
    "status" "DecisionStatus" NOT NULL DEFAULT 'proposed',
    "scope" "DecisionScope" NOT NULL DEFAULT 'fleet',
    "lane" VARCHAR(100),
    "client_id" UUID,
    "project_id" UUID,
    "charter_id" UUID,
    "site_id" UUID,
    "accord_id" UUID,
    "author_user_id" UUID,
    "author_contact_id" UUID,
    "ruled_at" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "supersedes_id" UUID,
    "conflict_note" TEXT,
    "confidence" DECIMAL(3,2),
    "confirmed_by_user_id" UUID,
    "confirmed_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_sources" (
    "id" UUID NOT NULL,
    "decision_id" UUID NOT NULL,
    "kind" "DecisionSourceKind" NOT NULL,
    "ref" VARCHAR(1000) NOT NULL,
    "thread_ref" VARCHAR(1000),
    "quote" TEXT,
    "author_label" VARCHAR(200),
    "author_user_id" UUID,
    "author_contact_id" UUID,
    "at" TIMESTAMP(3),
    "extracted_by" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_links" (
    "id" UUID NOT NULL,
    "decision_id" UUID NOT NULL,
    "entity_kind" VARCHAR(50) NOT NULL,
    "entity_id" VARCHAR(500) NOT NULL,
    "relation" VARCHAR(50) NOT NULL DEFAULT 'governs',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "decisions_key_key" ON "decisions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "decisions_supersedes_id_key" ON "decisions"("supersedes_id");

-- CreateIndex
CREATE INDEX "decisions_status_idx" ON "decisions"("status");

-- CreateIndex
CREATE INDEX "decisions_scope_idx" ON "decisions"("scope");

-- CreateIndex
CREATE INDEX "decisions_lane_idx" ON "decisions"("lane");

-- CreateIndex
CREATE INDEX "decisions_client_id_idx" ON "decisions"("client_id");

-- CreateIndex
CREATE INDEX "decisions_project_id_idx" ON "decisions"("project_id");

-- CreateIndex
CREATE INDEX "decisions_charter_id_idx" ON "decisions"("charter_id");

-- CreateIndex
CREATE INDEX "decisions_site_id_idx" ON "decisions"("site_id");

-- CreateIndex
CREATE INDEX "decisions_accord_id_idx" ON "decisions"("accord_id");

-- CreateIndex
CREATE INDEX "decision_sources_decision_id_idx" ON "decision_sources"("decision_id");

-- CreateIndex
CREATE UNIQUE INDEX "decision_sources_decision_id_kind_ref_key" ON "decision_sources"("decision_id", "kind", "ref");

-- CreateIndex
CREATE INDEX "decision_links_entity_kind_entity_id_idx" ON "decision_links"("entity_kind", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "decision_links_decision_id_entity_kind_entity_id_relation_key" ON "decision_links"("decision_id", "entity_kind", "entity_id", "relation");

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_sources" ADD CONSTRAINT "decision_sources_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_links" ADD CONSTRAINT "decision_links_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

