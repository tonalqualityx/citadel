-- Contact pronouns: the pronouns and where they came from (stated, signature, assumed). Additive and
-- idempotent: a re-run adds nothing and drops nothing.
ALTER TABLE "client_contacts" ADD COLUMN IF NOT EXISTS "pronouns" VARCHAR(50);
ALTER TABLE "client_contacts" ADD COLUMN IF NOT EXISTS "pronouns_source" VARCHAR(20);
