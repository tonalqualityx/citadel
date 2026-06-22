-- Per-owner BrandProfile (voice + branding) feeding the voice/design quality gates. Polymorphic
-- owner: exactly one of client_id / site_id (CHECK), at most one profile per owner (unique indexes).
-- Per-field cascade resolution lives in the app layer. Additive, reversible — a new table only.

-- CreateTable
CREATE TABLE "brand_profiles" (
    "id" UUID NOT NULL,
    "client_id" UUID,
    "site_id" UUID,
    "voice_profile" JSONB,
    "figma_url" VARCHAR(500),
    "component_library_ref" VARCHAR(255),
    "brand_tokens" JSONB,
    "notes" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brand_profiles_client_id_key" ON "brand_profiles"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "brand_profiles_site_id_key" ON "brand_profiles"("site_id");

-- AddForeignKey
ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Exactly one owner: client XOR site (Prisma does not manage CHECK constraints, so no migrate drift)
ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_owner_chk" CHECK (("client_id" IS NOT NULL) <> ("site_id" IS NOT NULL));
