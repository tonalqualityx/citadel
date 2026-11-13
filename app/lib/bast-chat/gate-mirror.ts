/**
 * Bast chat v2: a mirror of the citadel worker's spawn gate, for the reach check (worker-reach.ts).
 *
 * The worker on Mike's machine (cron every 10 minutes, ~/.local/bin/citadel-worker.sh) asks
 * ~/.claude/tools/citadel-worker/spawn-gate.py whether there is work, then runs a full agent session
 * with a shell. Every value below is copied from those machine files, and each comment names the file
 * and line it mirrors (as read on 2026-11-10). A drift test on the machine (plan task S1-M3) compares
 * them with the live files, so keep each one a plain exported string or array of strings.
 *
 * This file does not reuse lib/oracle/projects/gate-constants.ts on purpose: that copy's BLOCKING_TAGS
 * is missing three of gate.json's seven tags (scheduled, client-plan-approval, plan-approval), which is
 * why its own drift test fails today.
 */

/** Paths of the machine files mirrored here, for the drift test. */
export const GATE_JSON_PATH = '~/.config/citadel-worker/gate.json';
export const SPAWN_GATE_PATH = '~/.claude/tools/citadel-worker/spawn-gate.py';
export const WORKER_RUNNER_PATH = '~/.local/bin/citadel-worker.sh';

/** gate.json line 3, `assignee_id`: the Bast user. The worker only takes tasks assigned to this id. */
export const BAST_USER_ID = 'ca5335e7-a374-4eff-92dc-fd67ceef2297';

/**
 * gate.json lines 13 to 19, `bot_user_ids`. A last comment by one of these ids is "not human" to the gate
 * (spawn-gate.py lines 432 to 434), unless the comment also carries `author_contact_id` (a client wrote it).
 * Order kept as in gate.json so the drift test can compare arrays directly.
 */
export const BOT_USER_IDS: readonly string[] = [
  'ca5335e7-a374-4eff-92dc-fd67ceef2297', // Bast
  '7e5d9924-6b58-47d6-9865-c6e98027d2cf', // Troubador
  '9fc0c13c-4943-4d84-9b04-ff56e087228e', // Oracle
  '49a29755-e183-4c8e-a741-363fa1edbcd6', // Test
  'fc628c63-b14b-40f0-b1db-1a55fd4d00ae', // Designer Portal worker (not named in gate.json's _bot_user_ids_doc)
  '1797579d-2c5e-42de-8366-c38be92ee1ae', // Dox, the office manager (dox@indelible.bot, 2026-11-13)
];

/**
 * gate.json lines 26 to 28, `delegate_user_ids` (Sabeen). A delegate's open task whose last comment is
 * human wakes the worker (`delegate_comment`, spawn-gate.py lines 529 to 532 and 545), and the session may
 * then reassign it to Bast and work it (worker SKILL.md lines 342 to 363).
 */
export const DELEGATE_USER_IDS: readonly string[] = ['b565b492-cdea-497b-a13d-85f003916bf9'];

/** gate.json `_delegate_user_ids_doc` line 30: the one delegate today. */
export const SABEEN_USER_ID = 'b565b492-cdea-497b-a13d-85f003916bf9';

/** spawn-gate.py line 122, `MIKE_ID` (not in gate.json). */
export const MIKE_USER_ID = '3ecfb7be-20bb-43cb-9b4d-31c44337dc81';

/**
 * gate.json `blocking_tags`. A Bast `not_started` task carrying one is parked, not eligible
 * (spawn-gate.py `classify`, lines 367 to 381). Parked cards still wake on a human last comment.
 * Order kept as in gate.json.
 */
export const BLOCKING_TAGS: readonly string[] = [
  'needs-mike',
  'cockpit-owned',
  'awaiting-clarification',
  'needs-pm-release',
  'scheduled',
  'client-plan-approval',
  'plan-approval',
  'design-runner',
];

/**
 * spawn-gate.py line 348, `CHAT_PARKED_TAGS`. Applied in code, not from gate.json: a Bast not_started or
 * blocked task with this tag is dropped from both lists (lines 370 to 374), so it is neither eligible nor
 * woken until the tag goes.
 */
export const CHAT_PARKED_TAGS: readonly string[] = ['chat-clarifying'];

/** spawn-gate.py line 123, `COCKPIT_OWNED_TAG`: an in_progress Bast task with it is not a stale wake (536 to 539). */
export const COCKPIT_OWNED_TAG = 'cockpit-owned';

/** spawn-gate.py line 451, `CLIENT_APPROVED_TAG`: on a Bast review card it is the client's yes, and the worker publishes. */
export const CLIENT_APPROVED_TAG = 'client-approved';

/**
 * spawn-gate.py lines 520 to 527: the Bast queues the gate reads, by status. `done` is read only with
 * needs_review true and approved false (`pending_review=true`, lines 279 to 286 and 523).
 */
export const BAST_QUEUE_STATUSES: readonly string[] = ['not_started', 'blocked', 'in_progress', 'review'];
export const BAST_REVIEW_PENDING_STATUS = 'done';

/** spawn-gate.py lines 274 to 276: the delegate statuses the gate reads (`review` and `abandoned` are not read). */
export const DELEGATE_QUEUE_STATUSES: readonly string[] = ['not_started', 'blocked', 'in_progress'];

/** spawn-gate.py line 327, `SATISFIED_BLOCKER_STATUSES`: a blocker in one of these no longer parks its dependent at the gate. */
export const SATISFIED_BLOCKER_STATUSES: readonly string[] = ['done', 'abandoned'];

/** prisma/schema.prisma `enum TaskStatus`: every status Citadel knows. Anything else is unknown to the reach check. */
export const TASK_STATUSES: readonly string[] = ['triage', 'not_started', 'in_progress', 'review', 'done', 'blocked', 'abandoned'];
