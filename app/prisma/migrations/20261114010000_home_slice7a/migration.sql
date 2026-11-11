-- Home screen Slice 7a: nightly and weekly measures. New table only. No ALTER TYPE.

-- CreateTable
CREATE TABLE "home_measures" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_measures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "home_measures_user_id_date_kind_key" ON "home_measures"("user_id", "date", "kind");

-- AddForeignKey
ALTER TABLE "home_measures" ADD CONSTRAINT "home_measures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
