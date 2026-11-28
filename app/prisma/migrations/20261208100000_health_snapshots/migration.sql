-- Home health tiles: one reading per measure per day, for each tile's own 12 week average. A new table only; nothing else changes.
CREATE TABLE "health_snapshots" (
    "id" UUID NOT NULL,
    "measure" VARCHAR(40) NOT NULL,
    "day" DATE NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "health_snapshots_measure_day_key" ON "health_snapshots"("measure", "day");
