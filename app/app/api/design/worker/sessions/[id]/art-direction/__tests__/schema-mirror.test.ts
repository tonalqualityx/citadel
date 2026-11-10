// @vitest-environment node
// W4.4a: the daemon keeps a box-side mirror of directionBodySchema (DP/src/tools/art-direction-schema.ts). Both sides are
// held to one recorded JSON Schema. The copy in this repo (lib/design/__fixtures__/art-direction.schema.json) is the
// source of truth and is checked everywhere, CI included. The daemon holds a byte-for-byte copy at
// DP/test/fixtures/art-direction.schema.json, which its own test compares its mirror to; on a machine that has the
// daemon, this test also checks the two copies are the same bytes.
// After a deliberate schema change: run this test once with RECORD_ART_DIRECTION_FIXTURE=1 (it rewrites the repo copy,
// and the daemon copy when the daemon is present), then bring the daemon's mirror level and run the daemon gate.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { directionBodySchema } from '@/lib/design/track-direction';

const REPO_FIXTURE = path.join(process.cwd(), 'lib/design/__fixtures__/art-direction.schema.json');
const DAEMON_FIXTURE = process.env.DESIGNER_PORTAL_SCHEMA_FIXTURE ?? path.join(os.homedir(), '.claude/tools/designer-portal/test/fixtures/art-direction.schema.json');
const RECORD = !!process.env.RECORD_ART_DIRECTION_FIXTURE;
const live = () => JSON.stringify(z.toJSONSchema(directionBodySchema, { unrepresentable: 'any' }), null, 1) + '\n';

describe('art direction schema mirror', () => {
  it.skipIf(!RECORD)('records the fixture', () => {
    fs.writeFileSync(REPO_FIXTURE, live());
    if (fs.existsSync(DAEMON_FIXTURE)) fs.writeFileSync(DAEMON_FIXTURE, live());
  });
  it.skipIf(RECORD)('the live schema equals the recorded fixture', () => {
    expect(live()).toBe(fs.readFileSync(REPO_FIXTURE, 'utf8'));
  });
  it.skipIf(RECORD || !fs.existsSync(DAEMON_FIXTURE))('the daemon holds the same fixture, byte for byte', () => {
    expect(fs.readFileSync(DAEMON_FIXTURE, 'utf8')).toBe(fs.readFileSync(REPO_FIXTURE, 'utf8'));
  });
});
