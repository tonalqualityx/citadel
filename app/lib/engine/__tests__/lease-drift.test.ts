import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { LEASE_MS, HEARTBEAT_MS, MAX_HEARTBEATS } from '../queue';

/**
 * The runner's job budget (portal-chat/runner.py) rests on THIS branch's lease numbers: 120 s, +60 s,
 * twice, so 240 s at most. The constants are imported straight from queue.ts, so the test reads the code
 * under test and cannot skip; it fails if either side moves without the other.
 */
const RUNNER = '/home/mike/.claude/tools/portal-chat/runner.py';

function runnerConst(name: string): number {
  const text = fs.readFileSync(RUNNER, 'utf8'); // throws (a failure, not a skip) if the runner is missing
  const m = new RegExp(`^${name} = (\\d+)`, 'm').exec(text);
  if (!m) throw new Error(`runner.py has no ${name}`);
  return Number(m[1]);
}

describe('the runner lease numbers match the Citadel queue', () => {
  it('initial lease, heartbeat step and heartbeat count agree', () => {
    expect(runnerConst('LEASE_INITIAL_S')).toBe(LEASE_MS / 1000);
    expect(runnerConst('LEASE_BEAT_S')).toBe(HEARTBEAT_MS / 1000);
    expect(runnerConst('LEASE_BEATS')).toBe(MAX_HEARTBEATS);
  });

  it('the job budget plus the post margin fits the longest lease', () => {
    const longest = LEASE_MS / 1000 + (HEARTBEAT_MS / 1000) * MAX_HEARTBEATS;
    const budget = longest - runnerConst('POST_MARGIN_S');
    expect(runnerConst('LEASE_INITIAL_S') + runnerConst('LEASE_BEAT_S') * runnerConst('LEASE_BEATS')).toBe(longest);
    expect(budget).toBeLessThan(longest);
    // Two full Claude runs would not fit; that is why the second run gets only what is left.
    expect(2 * runnerConst('ENGINE_TIMEOUT_S')).toBeGreaterThan(budget);
  });
});
