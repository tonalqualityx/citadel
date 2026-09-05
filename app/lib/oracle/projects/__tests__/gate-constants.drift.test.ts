import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BLOCKING_TAGS, BOT_USER_IDS, BAST_USER_ID, MIKE_USER_ID } from '../gate-constants';

// Oracle Projects Tab Phase 2 — gate-constants.ts hand-copies three fields out of
// ~/.config/citadel-worker/gate.json (blocking_tags, bot_user_ids, assignee_id) so that
// classifyProjectBlockers agrees with the citadel-worker spawn gate about which tags
// block a card and which user ids are bots. A hand copy can silently drift the moment
// someone edits gate.json without remembering this file exists — this test re-reads the
// live config at test time and fails loudly the instant the two disagree.
//
// The config lives outside this repo (a machine-local file, not checked into git), so a
// CI runner or a fresh checkout without it present has nothing to compare against. That
// is NOT a drift failure — it's a "can't check" state — so the suite skips with a clear
// reason rather than failing red.
const GATE_CONFIG_PATH = path.join(os.homedir(), '.config', 'citadel-worker', 'gate.json');
const gateConfigExists = fs.existsSync(GATE_CONFIG_PATH);

describe.skipIf(!gateConfigExists)(
  'gate-constants.ts drift check against ~/.config/citadel-worker/gate.json',
  () => {
    const gateConfig = gateConfigExists
      ? (JSON.parse(fs.readFileSync(GATE_CONFIG_PATH, 'utf-8')) as {
          assignee_id: string;
          blocking_tags: string[];
          bot_user_ids: string[];
        })
      : null;

    it('BLOCKING_TAGS matches gate.json blocking_tags exactly', () => {
      expect(BLOCKING_TAGS).toEqual(gateConfig!.blocking_tags);
    });

    it('BOT_USER_IDS matches gate.json bot_user_ids exactly', () => {
      expect(BOT_USER_IDS).toEqual(gateConfig!.bot_user_ids);
    });

    it('BAST_USER_ID matches gate.json assignee_id', () => {
      expect(BAST_USER_ID).toBe(gateConfig!.assignee_id);
    });
  }
);

if (!gateConfigExists) {
  describe('gate-constants.ts drift check', () => {
    it.skip(`SKIPPED: ${GATE_CONFIG_PATH} not found on this machine (expected in CI / a fresh checkout) — cannot verify drift against the live gate config here`, () => {});
  });
}

// Judgment call OVERTURNED (verification pass): MIKE_USER_ID has no home in gate.json
// (the gate itself never asks "is this Mike"), but it IS hardcoded in spawn-gate.py as
// MIKE_ID — so it CAN be drift-checked, just against a different file, via a plain
// regex grep rather than JSON.parse.
const SPAWN_GATE_PATH = path.join(os.homedir(), '.claude', 'tools', 'citadel-worker', 'spawn-gate.py');
const spawnGateExists = fs.existsSync(SPAWN_GATE_PATH);

function extractMikeId(source: string): string | null {
  const match = source.match(/MIKE_ID\s*=\s*["']([^"']+)["']/);
  return match ? match[1] : null;
}

describe.skipIf(!spawnGateExists)(
  'gate-constants.ts MIKE_USER_ID drift check against spawn-gate.py MIKE_ID',
  () => {
    const source = spawnGateExists ? fs.readFileSync(SPAWN_GATE_PATH, 'utf-8') : '';
    const mikeId = extractMikeId(source);

    it('MIKE_USER_ID matches spawn-gate.py\'s hardcoded MIKE_ID', () => {
      expect(mikeId).not.toBeNull();
      expect(MIKE_USER_ID).toBe(mikeId);
    });
  }
);

if (!spawnGateExists) {
  describe('gate-constants.ts MIKE_USER_ID drift check', () => {
    it.skip(`SKIPPED: ${SPAWN_GATE_PATH} not found on this machine (expected in CI / a fresh checkout) — cannot verify MIKE_USER_ID drift here`, () => {});
  });
}
