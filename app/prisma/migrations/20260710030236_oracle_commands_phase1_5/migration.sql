-- CreateTable
CREATE TABLE "oracle_commands" (
    "id" UUID NOT NULL,
    "machine_id" UUID NOT NULL,
    "verb" VARCHAR(50) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "created_by_id" UUID NOT NULL,
    "claimed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "result" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oracle_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "oracle_commands_machine_id_status_idx" ON "oracle_commands"("machine_id", "status");

-- AddForeignKey
ALTER TABLE "oracle_commands" ADD CONSTRAINT "oracle_commands_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "oracle_machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_commands" ADD CONSTRAINT "oracle_commands_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
