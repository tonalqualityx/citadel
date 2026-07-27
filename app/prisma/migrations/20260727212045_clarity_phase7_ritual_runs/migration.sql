-- CreateTable
CREATE TABLE "ritual_runs" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" VARCHAR(20) NOT NULL DEFAULT 'morning',
    "ran_at" TIMESTAMP(3),
    "bailed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ritual_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ritual_runs_date_kind_key" ON "ritual_runs"("date", "kind");
