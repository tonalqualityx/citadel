// Oracle Projects Tab Phase 2 — constants shared with the citadel-worker spawn gate
// (~/.claude/tools/citadel-worker/spawn-gate.py, config ~/.config/citadel-worker/gate.json).
// classifyProjectBlockers (./blockers.ts) needs the SAME "who counts as a bot" and "which
// tags block a card" answers the gate uses, or the Projects tab and the worker would
// silently disagree about which cards are parked-on-a-human vs parked-on-a-bot.
//
// BLOCKING_TAGS / BOT_USER_IDS / BAST_USER_ID are copied verbatim from gate.json's
// `blocking_tags`, `bot_user_ids`, and `assignee_id` fields respectively — see
// __tests__/gate-constants.drift.test.ts, which re-reads that file at test time and
// fails loudly if this copy has drifted.
//
// MIKE_USER_ID is NOT in gate.json (the gate never needs to check "is this Mike" — it
// only checks "is this a bot"). It's copied from spawn-gate.py's own hardcoded MIKE_ID
// constant instead. There's no file for a drift test to re-read against for this one
// value; if spawn-gate.py's MIKE_ID ever changes, this constant has to be updated by
// hand alongside it.
export const BLOCKING_TAGS: readonly string[] = ['needs-mike', 'cockpit-owned', 'awaiting-clarification'];

export const BOT_USER_IDS: readonly string[] = [
  'ca5335e7-a374-4eff-92dc-fd67ceef2297', // Bast
  '7e5d9924-6b58-47d6-9865-c6e98027d2cf', // Troubador
  '9fc0c13c-4943-4d84-9b04-ff56e087228e', // Oracle
  '49a29755-e183-4c8e-a741-363fa1edbcd6', // Test
];

// = gate.json's assignee_id (Bast's own user id) — also the first entry of BOT_USER_IDS.
export const BAST_USER_ID = 'ca5335e7-a374-4eff-92dc-fd67ceef2297';

// = spawn-gate.py's hardcoded MIKE_ID. See the module doc comment above — not present in
// gate.json, so not covered by the drift test.
export const MIKE_USER_ID = '3ecfb7be-20bb-43cb-9b4d-31c44337dc81';
