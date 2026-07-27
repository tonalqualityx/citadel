-- CreateTable
CREATE TABLE "triage_stats" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "archived_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "triage_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "triage_stats_date_key" ON "triage_stats"("date");
