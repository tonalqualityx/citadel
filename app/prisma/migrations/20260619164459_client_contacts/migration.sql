-- CreateTable
CREATE TABLE "client_contacts" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "name" VARCHAR(255),
    "email" VARCHAR(255) NOT NULL,
    "role" VARCHAR(100),
    "can_initiate_work" BOOLEAN NOT NULL DEFAULT false,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_contacts_email_idx" ON "client_contacts"("email");

-- CreateIndex
CREATE INDEX "client_contacts_client_id_idx" ON "client_contacts"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_contacts_client_id_email_key" ON "client_contacts"("client_id", "email");

-- AddForeignKey
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: seed each client's existing primary contact as an AUTHORIZED contact.
-- Decision (2026-06-19): the primary contact can initiate work by default; additional
-- contacts are added per client and authorized individually via the contacts UI.
INSERT INTO "client_contacts" ("id", "client_id", "name", "email", "can_initiate_work", "is_primary", "updated_at")
SELECT gen_random_uuid(), c."id", c."primary_contact", trim(c."email"), true, true, CURRENT_TIMESTAMP
FROM "clients" c
WHERE c."is_deleted" = false
  AND c."email" IS NOT NULL
  AND trim(c."email") <> '';
