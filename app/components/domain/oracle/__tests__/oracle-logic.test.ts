import { describe, it, expect } from 'vitest';
import type { OracleAgentDTO, OracleMachineDTO, OracleSessionDTO } from '@/lib/types/oracle';
import {
  getStatusMeta,
  selectWaitingSessions,
  groupNonWaitingSessions,
  sessionMatchesFilter,
  filterMachines,
  formatElapsed,
  formatTokens,
  sessionDisplayTitle,
} from '../oracle-logic';

function makeAgent(overrides: Partial<OracleAgentDTO> = {}): OracleAgentDTO {
  return {
    id: 'agent-1',
    external_id: 'agent-1',
    label: 'Worker A',
    phase: 'build',
    model: 'claude-sonnet-5',
    status: 'running',
    activity: 'writing code',
    tokens: 100,
    duration_ms: null,
    started_at: null,
    ended_at: null,
    ...overrides,
  };
}

function makeSession(overrides: Partial<OracleSessionDTO> = {}): OracleSessionDTO {
  return {
    id: 'session-1',
    external_id: 'ext-1',
    source: 'claude_code',
    title: 'Some session',
    cwd: '/home/mike/project',
    model: 'claude-sonnet-5',
    status: 'running',
    needs_attention: false,
    attention_reason: null,
    started_at: '2026-07-09T20:00:00.000Z',
    last_event_at: '2026-07-09T20:10:00.000Z',
    ended_at: null,
    tokens_total: 1000,
    agents: [],
    ...overrides,
  };
}

function makeMachine(sessions: OracleSessionDTO[], overrides: Partial<OracleMachineDTO> = {}): OracleMachineDTO {
  return {
    id: 'machine-1',
    name: 'reshi-workstation',
    hostname: 'reshi.local',
    last_heartbeat_at: '2026-07-09T20:11:00.000Z',
    stale: false,
    sessions,
    ...overrides,
  };
}

describe('getStatusMeta', () => {
  it('maps running to accent with pulse', () => {
    const meta = getStatusMeta('running');
    expect(meta.colorVar).toBe('--accent');
    expect(meta.pulse).toBe(true);
    expect(meta.ring).toBe(false);
  });

  it('maps waiting to warning without a ring', () => {
    const meta = getStatusMeta('waiting');
    expect(meta.colorVar).toBe('--warning');
    expect(meta.ring).toBe(false);
  });

  it('needs_attention always wins and adds a ring, regardless of status', () => {
    const waiting = getStatusMeta('waiting', true);
    const running = getStatusMeta('running', true);
    expect(waiting.kind).toBe('needs_attention');
    expect(waiting.colorVar).toBe('--warning');
    expect(waiting.ring).toBe(true);
    expect(running.kind).toBe('needs_attention');
    expect(running.ring).toBe(true);
  });

  it('maps done/ended to success', () => {
    expect(getStatusMeta('done').colorVar).toBe('--success');
    expect(getStatusMeta('ended').colorVar).toBe('--success');
  });

  it('maps failed to error, never warning (house rule: warning is never red)', () => {
    const meta = getStatusMeta('failed');
    expect(meta.colorVar).toBe('--error');
    expect(meta.colorVar).not.toBe('--warning');
  });

  it('maps stale and queued to the muted text variable', () => {
    expect(getStatusMeta('stale').colorVar).toBe('--text-muted');
    expect(getStatusMeta('queued').colorVar).toBe('--text-muted');
  });

  it('falls back to a muted unknown pill for unrecognized statuses', () => {
    const meta = getStatusMeta('some-new-status-from-heartbeat');
    expect(meta.kind).toBe('unknown');
    expect(meta.colorVar).toBe('--text-muted');
    expect(meta.label).toBe('some-new-status-from-heartbeat');
  });

  it('handles null/undefined status without throwing', () => {
    expect(getStatusMeta(null).kind).toBe('unknown');
    expect(getStatusMeta(undefined).kind).toBe('unknown');
  });
});

describe('selectWaitingSessions', () => {
  it('includes only waiting or needs_attention sessions', () => {
    const now = Date.parse('2026-07-09T21:00:00.000Z');
    const running = makeSession({ id: 'a', status: 'running' });
    const waiting = makeSession({ id: 'b', status: 'waiting' });
    const flaggedRunning = makeSession({ id: 'c', status: 'running', needs_attention: true });
    const ended = makeSession({ id: 'd', status: 'ended' });

    const machines = [makeMachine([running, waiting, flaggedRunning, ended])];
    const result = selectWaitingSessions(machines, now);

    expect(result.map((s) => s.id).sort()).toEqual(['b', 'c']);
  });

  it('orders by wait time DESC — longest wait first', () => {
    const now = Date.parse('2026-07-09T21:00:00.000Z');
    // last_event_at 5 min ago
    const recentWait = makeSession({
      id: 'recent',
      status: 'waiting',
      last_event_at: '2026-07-09T20:55:00.000Z',
    });
    // last_event_at 90 min ago — has waited far longer
    const longWait = makeSession({
      id: 'long',
      status: 'waiting',
      last_event_at: '2026-07-09T19:30:00.000Z',
    });
    const machines = [makeMachine([recentWait, longWait])];

    const result = selectWaitingSessions(machines, now);
    expect(result.map((s) => s.id)).toEqual(['long', 'recent']);
  });

  it('falls back to started_at when last_event_at is absent', () => {
    const now = Date.parse('2026-07-09T21:00:00.000Z');
    const session = makeSession({
      id: 'no-last-event',
      status: 'waiting',
      last_event_at: null,
      started_at: '2026-07-09T20:00:00.000Z',
    });
    const machines = [makeMachine([session])];
    const result = selectWaitingSessions(machines, now);
    expect(result).toHaveLength(1);
  });

  it('attaches the parent machine to each flattened session', () => {
    const now = Date.parse('2026-07-09T21:00:00.000Z');
    const session = makeSession({ id: 'x', status: 'waiting' });
    const machine = makeMachine([session], { name: 'my-machine' });
    const result = selectWaitingSessions([machine], now);
    expect(result[0].machine.name).toBe('my-machine');
  });
});

describe('groupNonWaitingSessions', () => {
  it('buckets by source first, then status, and always excludes waiting/needs_attention', () => {
    const running = makeSession({ id: 'running', source: 'claude_code', status: 'running' });
    const waiting = makeSession({ id: 'waiting', source: 'claude_code', status: 'waiting' });
    const workflow = makeSession({ id: 'workflow', source: 'workflow', status: 'running' });
    const endedWorkflow = makeSession({ id: 'workflow-ended', source: 'workflow', status: 'ended' });
    const cron = makeSession({ id: 'cron', source: 'openclaw_cron', status: 'ended' });
    const endedDirect = makeSession({ id: 'ended-direct', source: 'claude_code', status: 'ended' });
    const stale = makeSession({ id: 'stale-direct', source: 'claude_code', status: 'stale' });

    const machine = makeMachine([running, waiting, workflow, endedWorkflow, cron, endedDirect, stale]);
    const groups = groupNonWaitingSessions([machine]);

    expect(groups.running.map((s) => s.id)).toEqual(['running']);
    expect(groups.workflows.map((s) => s.id).sort()).toEqual(['workflow', 'workflow-ended']);
    expect(groups.crons.map((s) => s.id)).toEqual(['cron']);
    expect(groups.recentlyEnded.map((s) => s.id).sort()).toEqual(['ended-direct', 'stale-direct']);

    // waiting session must never appear in any bucket
    const allIds = [
      ...groups.running,
      ...groups.workflows,
      ...groups.crons,
      ...groups.recentlyEnded,
    ].map((s) => s.id);
    expect(allIds).not.toContain('waiting');
  });
});

describe('sessionMatchesFilter / filterMachines', () => {
  it('matches on session title, cwd, model, and source', () => {
    const session = makeSession({ title: 'Wright build', cwd: '/home/mike/clients/oddfox' });
    expect(sessionMatchesFilter(session, 'wright')).toBe(true);
    expect(sessionMatchesFilter(session, 'oddfox')).toBe(true);
    expect(sessionMatchesFilter(session, 'nonexistent')).toBe(false);
  });

  it('matches on agent label/activity when the session itself does not match', () => {
    const session = makeSession({
      title: 'Fan-out run',
      agents: [makeAgent({ label: 'Homepage build', activity: 'Writing component markup' })],
    });
    expect(sessionMatchesFilter(session, 'homepage')).toBe(true);
    expect(sessionMatchesFilter(session, 'component markup')).toBe(true);
  });

  it('blank filter matches everything', () => {
    expect(sessionMatchesFilter(makeSession(), '')).toBe(true);
    expect(sessionMatchesFilter(makeSession(), '   ')).toBe(true);
  });

  it('filterMachines drops machines with zero matching sessions', () => {
    const matching = makeSession({ id: 'match', title: 'Grantibly gate review' });
    const nonMatching = makeSession({ id: 'no-match', title: 'Unrelated session' });
    const machineWithMatch = makeMachine([matching, nonMatching], { id: 'm1' });
    const machineWithoutMatch = makeMachine([nonMatching], { id: 'm2' });

    const result = filterMachines([machineWithMatch, machineWithoutMatch], 'grantibly');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('m1');
    expect(result[0].sessions.map((s) => s.id)).toEqual(['match']);
  });
});

describe('formatElapsed', () => {
  it('formats sub-hour durations as M:SS', () => {
    expect(formatElapsed(65_000)).toBe('1:05');
    expect(formatElapsed(0)).toBe('0:00');
  });

  it('formats durations over an hour as H:MM:SS', () => {
    expect(formatElapsed(3_665_000)).toBe('1:01:05');
  });

  it('never goes negative', () => {
    expect(formatElapsed(-500)).toBe('0:00');
  });
});

describe('formatTokens', () => {
  it('formats with thousands separators and a tok suffix', () => {
    expect(formatTokens(184_320)).toBe('184,320 tok');
  });

  it('treats null/undefined as zero', () => {
    expect(formatTokens(null)).toBe('0 tok');
    expect(formatTokens(undefined)).toBe('0 tok');
  });

  it('defaults to exact (no prefix) when approx is omitted', () => {
    expect(formatTokens(184_320)).not.toMatch(/^≈/);
  });

  it('prefixes with ≈ when approx is true (claude_code sampled counts)', () => {
    expect(formatTokens(184_320, true)).toBe('≈184,320 tok');
  });

  it('does not prefix when approx is explicitly false (workflow/cron exact counts)', () => {
    expect(formatTokens(184_320, false)).toBe('184,320 tok');
  });
});

describe('sessionDisplayTitle', () => {
  it('prefers the harness title', () => {
    expect(sessionDisplayTitle(makeSession({ title: 'My Title' }))).toBe('My Title');
  });

  it('falls back to the cwd basename', () => {
    expect(
      sessionDisplayTitle(makeSession({ title: null, cwd: '/home/mike/clients/oddfox' }))
    ).toBe('oddfox');
  });

  it('falls back to a short id when neither title nor cwd exist', () => {
    expect(
      sessionDisplayTitle(makeSession({ title: null, cwd: null, external_id: 'abcdefghijklmnop' }))
    ).toBe('abcdefghijkl');
  });
});
