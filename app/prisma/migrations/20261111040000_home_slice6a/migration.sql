-- Home screen Slice 6a: a site down signal per user (watchdog or uptime mail, plus Bast's own check).
-- New table only. No ALTER TYPE.

-- CreateTable
CREATE TABLE "home_site_incident" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "domain" VARCHAR(255) NOT NULL,
    "client_id" UUID,
    "source" VARCHAR(20) NOT NULL,
    "monitor" VARCHAR(255),
    "ask_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "started_at" TIMESTAMP(3) NOT NULL,
    "last_checked_at" TIMESTAMP(3),
    "last_check_up" BOOLEAN,
    "check_summary" VARCHAR(500),
    "watchdog_escalated" BOOLEAN NOT NULL DEFAULT false,
    "closed_at" TIMESTAMP(3),
    "close_reason" VARCHAR(30),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "home_site_incident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "home_site_incident_user_id_site_id_closed_at_idx" ON "home_site_incident"("user_id", "site_id", "closed_at");

-- AddForeignKey
ALTER TABLE "home_site_incident" ADD CONSTRAINT "home_site_incident_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
