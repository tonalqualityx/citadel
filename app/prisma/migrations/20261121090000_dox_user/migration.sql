-- Dox, the office manager, becomes a real Citadel user (a bot user, like Bast), so a card can be assigned to him
-- and a comment can mention him. Written once by `prisma migrate deploy`; safe to run again (ON CONFLICT DO NOTHING
-- on the id and on the unique email, so an existing row is never touched).
--
-- password_hash is a fixed marker that is not a bcrypt hash. bcrypt.compare against it is always false (a bcrypt hash is
-- 60 characters starting with $2), so no password can ever sign this user in. No credential is created here.
INSERT INTO "users" ("id", "email", "password_hash", "name", "role", "avatar_url", "is_active", "updated_at")
VALUES (
  '1797579d-2c5e-42de-8366-c38be92ee1ae',
  'dox@indelible.bot',
  'NO-PASSWORD-LOGIN:dox-service-user',
  'Dox',
  'pm',
  'https://citadel.becomeindelible.com/avatars/dox-512.jpg',
  true,
  CURRENT_TIMESTAMP
)
ON CONFLICT DO NOTHING;
