-- Fleet item 6: lane-scoped API key violations (additive: one new table, one index).
CREATE TABLE "api_key_violations" (
    "id" UUID NOT NULL,
    "api_key_id" UUID NOT NULL,
    "key_prefix" VARCHAR(20) NOT NULL,
    "lane" VARCHAR(40) NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "path" VARCHAR(300) NOT NULL,
    "enforced" BOOLEAN NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_key_violations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "api_key_violations_api_key_id_at_idx" ON "api_key_violations"("api_key_id", "at");

-- Fleet item 6 (scope change 2026-10-22): the lane of the API key that wrote a comment or an
-- activity row, stamped on the server. Additive, nullable.
ALTER TABLE "comments" ADD COLUMN "actor_lane" VARCHAR(40);
ALTER TABLE "activity_logs" ADD COLUMN "actor_lane" VARCHAR(40);
