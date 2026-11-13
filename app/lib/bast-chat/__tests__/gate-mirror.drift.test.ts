// @vitest-environment node
// gate-mirror.ts (the chat's copy of the citadel worker's spawn gate) must equal the machine file it mirrors. Same idea as
// lib/oracle/projects/__tests__/gate-constants.drift.test.ts. The file is machine-local config (no secret in it: tags and ids only);
// a runner without it has nothing to compare, which is a skip, not a failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { BAST_USER_ID, BLOCKING_TAGS, BOT_USER_IDS, DELEGATE_USER_IDS } from '../gate-mirror';

const GATE_CONFIG_PATH = path.join(os.homedir(), '.config', 'citadel-worker', 'gate.json');
const exists = fs.existsSync(GATE_CONFIG_PATH);

describe.skipIf(!exists)('gate-mirror.ts drift check against ~/.config/citadel-worker/gate.json', () => {
  const cfg = (exists ? JSON.parse(fs.readFileSync(GATE_CONFIG_PATH, 'utf-8')) : {}) as {
    assignee_id: string;
    blocking_tags: string[];
    bot_user_ids: string[];
    delegate_user_ids: string[];
  };
  it('BLOCKING_TAGS matches gate.json blocking_tags exactly', () => {
    expect(BLOCKING_TAGS).toEqual(cfg.blocking_tags);
  });
  it('BOT_USER_IDS matches gate.json bot_user_ids exactly', () => {
    expect(BOT_USER_IDS).toEqual(cfg.bot_user_ids);
  });
  it('BAST_USER_ID matches gate.json assignee_id', () => {
    expect(BAST_USER_ID).toBe(cfg.assignee_id);
  });
  it('DELEGATE_USER_IDS matches gate.json delegate_user_ids exactly', () => {
    expect(DELEGATE_USER_IDS).toEqual(cfg.delegate_user_ids);
  });
});
