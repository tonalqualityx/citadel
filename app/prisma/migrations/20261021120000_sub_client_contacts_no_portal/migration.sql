-- Portal A4 fix 7: sub-client contacts do not sign in.
-- Ruling (Mike, 2026-10-20/21, tracker section 9): "Nerd Herd: agency staff only sign in, Indelible header."
-- The A3 backfill gave every existing contact at least viewer, including contacts on clients of type
-- sub_client, which would let a sub-client's own people sign in. Set those to portal_role 'none'.
-- Data-only and additive: no schema change. can_initiate_work is deliberately left untouched (email-check
-- keeps using it). Reversible per row from the contacts tab. Contacts that hold a project grant keep
-- project-only access (role none + grant is the project-only rule).
UPDATE "client_contacts" AS cc
SET "portal_role" = 'none'
FROM "clients" AS c
WHERE c."id" = cc."client_id"
  AND c."type" = 'sub_client'
  AND cc."portal_role" <> 'none';
