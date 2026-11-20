-- Mike, 2026-11-20 ("Yes" to the FYI row): the four open asks on one thread written to someone else with Mike copied. Compare-and-set, idempotent;
-- never touches a row Mike decided, an urgent row, or one that moved on. A fresh database has none of these ids, so it is a no-op there.
UPDATE "email_asks" SET
  "disposition" = 'fyi',
  "disposition_reason" = 'Written to someone else about their own work. You were copied.',
  "decided_by" = 'bast',
  "addressed_to" = CASE "id"
    WHEN '60f3227f-5501-402b-938d-c3749edc3f0f' THEN 'Dan'
    WHEN '70aadb1c-d7d4-4083-a70b-38fe8f874044' THEN 'Lisa'
    WHEN '25976c82-f3f4-480f-8e42-27405906e6c4' THEN 'Lisa'
    WHEN '687d834a-2fa3-4429-a5f2-31853b2c7749' THEN 'Dan' END,
  "updated_at" = NOW()
WHERE "id" IN ('60f3227f-5501-402b-938d-c3749edc3f0f','70aadb1c-d7d4-4083-a70b-38fe8f874044','25976c82-f3f4-480f-8e42-27405906e6c4','687d834a-2fa3-4429-a5f2-31853b2c7749')
  AND "state" = 'open' AND "disposition" = 'reply_mike' AND "is_urgent" = false
  AND ("decided_by" IS NULL OR "decided_by" <> 'mike');
