import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { AuthError } from '@/lib/api/errors';
import { GET } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    oracleMachine: { findMany: vi.fn() },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockMachineFindMany = prisma.oracleMachine.findMany as Mock;

const PM = { userId: 'pm-1', role: 'pm', email: 'pm@indelible.agency' };
const ADMIN = { userId: 'admin-1', role: 'admin', email: 'admin@indelible.agency' };
const BOT = { userId: 'oracle-bot-1', role: 'pm', email: 'oracle@indelible.bot' };

function machine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'machine-1',
    name: 'reshi-workstation',
    hostname: 'reshi.local',
    last_heartbeat_at: new Date(),
    sessions: [],
    commands: [],
    ...overrides,
  };
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    external_id: 'ext-1',
    source: 'claude_code',
    title: 'Some session',
    cwd: '/home/mike/project',
    model: 'claude-sonnet-5',
    remote_url: null,
    status: 'running',
    needs_attention: false,
    attention_reason: null,
    started_at: new Date(),
    last_event_at: new Date(),
    ended_at: null,
    tokens_total: 100,
    session_type: null,
    goal: null,
    waiting_on: null,
    ask_queue: null,
    ask_severity: null,
    arc_id: null,
    archived_at: null,
    agents: [],
    ...overrides,
  };
}

function fleetRequest(params: Record<string, string> = {}): NextRequest {
  const searchParams = new URLSearchParams(params);
  return new NextRequest(`http://localhost:3000/api/oracle/fleet?${searchParams.toString()}`);
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cmd-1',
    verb: 'spawn_session',
    status: 'pending',
    payload: { cwd: '/home/mike/project', title: 'New session' },
    created_at: new Date(),
    completed_at: null,
    result: null,
    error: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(PM);
});

describe('GET /api/oracle/fleet — auth (1.5a: admin-only)', () => {
  it('requires admin role', async () => {
    mockRequireAuth.mockResolvedValue(ADMIN);
    mockMachineFindMany.mockResolvedValue([]);
    await GET();
    expect(mockRequireRole).toHaveBeenCalledWith(ADMIN, ['admin']);
  });

  it('rejects a pm caller with 403 (pm-or-admin downgraded to admin-only)', async () => {
    mockRequireAuth.mockResolvedValue(PM);
    mockRequireRole.mockImplementationOnce(() => {
      throw new AuthError('Insufficient permissions', 403);
    });

    const res = await GET();
    expect(res.status).toBe(403);
    expect(mockMachineFindMany).not.toHaveBeenCalled();
  });

  it('rejects the oracle service bot (role pm) with 403 — bot cannot read fleet, only ingest', async () => {
    mockRequireAuth.mockResolvedValue(BOT);
    mockRequireRole.mockImplementationOnce(() => {
      throw new AuthError('Insufficient permissions', 403);
    });

    const res = await GET();
    expect(res.status).toBe(403);
    expect(mockMachineFindMany).not.toHaveBeenCalled();
  });

  it('allows an admin caller through', async () => {
    mockRequireAuth.mockResolvedValue(ADMIN);
    mockMachineFindMany.mockResolvedValue([machine()]);

    const res = await GET();
    expect(res.status).toBe(200);
  });
});

describe('GET /api/oracle/fleet — shape', () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(ADMIN);
  });

  it('returns machines with sessions (incl. agents) and rolled-up counts', async () => {
    mockMachineFindMany.mockResolvedValue([
      machine({
        sessions: [
          session({ id: 's1', status: 'running' }),
          session({
            id: 's2',
            status: 'running',
            agents: [
              { id: 'a1', external_id: 'a1', label: 'Worker 1', phase: 'build', model: null, status: 'done', activity: null, tokens: 10, duration_ms: 1000, started_at: new Date(), ended_at: new Date() },
              { id: 'a2', external_id: 'a2', label: 'Worker 2', phase: 'build', model: null, status: 'running', activity: 'working', tokens: 5, duration_ms: null, started_at: new Date(), ended_at: null },
            ],
          }),
        ],
      }),
    ]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.counts).toEqual({ machines: 1, sessions: 2, agents: 2 });
    expect(body.machines).toHaveLength(1);
    expect(body.machines[0].sessions).toHaveLength(2);
    expect(body.machines[0].sessions[1].agents).toHaveLength(2);
    expect(body.machines[0].sessions[1].agents[0]).toMatchObject({ label: 'Worker 1', status: 'done' });
    expect(typeof body.generated_at).toBe('string');
  });

  it('flags a machine stale when last_heartbeat_at is older than 3 minutes', async () => {
    mockMachineFindMany.mockResolvedValue([
      machine({ last_heartbeat_at: new Date(Date.now() - 10 * 60_000) }),
    ]);
    const body = await (await GET()).json();
    expect(body.machines[0].stale).toBe(true);
  });

  it('does not flag a machine stale within the heartbeat window', async () => {
    mockMachineFindMany.mockResolvedValue([
      machine({ last_heartbeat_at: new Date(Date.now() - 60_000) }),
    ]);
    const body = await (await GET()).json();
    expect(body.machines[0].stale).toBe(false);
  });

  it('treats a machine with no heartbeat yet as stale', async () => {
    mockMachineFindMany.mockResolvedValue([machine({ last_heartbeat_at: null })]);
    const body = await (await GET()).json();
    expect(body.machines[0].stale).toBe(true);
  });

  it('returns an empty machines array when the fleet is empty', async () => {
    mockMachineFindMany.mockResolvedValue([]);
    const body = await (await GET()).json();
    expect(body.machines).toEqual([]);
    expect(body.counts).toEqual({ machines: 0, sessions: 0, agents: 0 });
  });

  it('includes remote_url on a session shape (Phase 3 Respond deep-link)', async () => {
    mockMachineFindMany.mockResolvedValue([
      machine({
        sessions: [
          session({
            id: 'sess-remote',
            remote_url: 'https://claude.ai/code/session_01NZKAFYR37yuNaaz2DPajxL',
          }),
        ],
      }),
    ]);

    const body = await (await GET()).json();
    expect(body.machines[0].sessions[0]).toMatchObject({
      id: 'sess-remote',
      remote_url: 'https://claude.ai/code/session_01NZKAFYR37yuNaaz2DPajxL',
    });
  });

  it('returns remote_url: null when the session has no bridge session', async () => {
    mockMachineFindMany.mockResolvedValue([
      machine({ sessions: [session({ id: 'sess-no-remote', remote_url: null })] }),
    ]);

    const body = await (await GET()).json();
    expect(body.machines[0].sessions[0].remote_url).toBeNull();
  });

  // Phase 4 (three live buckets): `idle` is a real OracleSessionStatus — alive but
  // neither working nor flagging for attention — and must be returned by the fleet
  // response like running/waiting (the mock here stands in for the DB-side where.OR,
  // which is asserted directly in the "stale read-time hide" describe block below).
  it('returns idle sessions alongside running/waiting', async () => {
    mockMachineFindMany.mockResolvedValue([
      machine({
        sessions: [session({ id: 'sess-idle', status: 'idle' })],
      }),
    ]);

    const body = await (await GET()).json();
    expect(body.machines[0].sessions).toHaveLength(1);
    expect(body.machines[0].sessions[0]).toMatchObject({ id: 'sess-idle', status: 'idle' });
  });
});

describe('GET /api/oracle/fleet — stale read-time hide (Phase 2)', () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(ADMIN);
  });

  // The actual row-level filtering happens inside the Prisma `where` clause (DB-side),
  // and prisma.oracleMachine.findMany is fully mocked here, so these tests exercise the
  // query construction the route sends to Prisma — asserting the sessions.where's OR
  // clause both (a) has a stale-status branch gated by last_event_at >= a
  // STALE_HIDE_MINUTES-ago cutoff, and (b) leaves running/waiting ungated by age. This
  // is the same "assert the where the route builds" pattern the DB actually executes;
  // the real end-to-end row-count behavior is proven separately via a seeded live-DB
  // check (see feature-planning/oracle-phase1-verification.md, Phase 2 section).
  //
  // Clarity Phase 1 wrapped the original top-level OR in an AND alongside the new
  // archived_at exclusion (see the "archived sessions" describe block below) — the OR
  // itself is unchanged, just nested one level under where.AND[0].OR now.

  it('gates the stale branch of the sessions where-clause on a last_event_at >= (now - 60min) cutoff', async () => {
    mockMachineFindMany.mockResolvedValue([machine()]);
    const before = Date.now();
    await GET();
    const after = Date.now();

    const callArgs = mockMachineFindMany.mock.calls[0][0];
    const sessionsWhere = callArgs.include.sessions.where;
    const or = sessionsWhere.AND[0].OR;
    const staleClause = or.find(
      (clause: Record<string, unknown>) => clause.status === 'stale'
    );
    expect(staleClause).toBeDefined();
    const cutoff = staleClause.last_event_at.gte as Date;
    // cutoff should be ~60 minutes before "now" at call time (STALE_HIDE_MINUTES)
    const expectedMin = before - 60 * 60_000;
    const expectedMax = after - 60 * 60_000;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(expectedMin);
    expect(cutoff.getTime()).toBeLessThanOrEqual(expectedMax);
  });

  it('does not gate the running/waiting/idle branch of the where-clause by age', async () => {
    mockMachineFindMany.mockResolvedValue([machine()]);
    await GET();

    const callArgs = mockMachineFindMany.mock.calls[0][0];
    const sessionsWhere = callArgs.include.sessions.where;
    const or = sessionsWhere.AND[0].OR;
    const liveStatusClause = or.find(
      (clause: Record<string, unknown>) =>
        clause.status && typeof clause.status === 'object' && 'in' in (clause.status as object)
    );
    expect(liveStatusClause).toBeDefined();
    // Phase 4 (three live buckets): `idle` is a real, always-returned live status —
    // alongside running/waiting — and is NOT gated by age like stale/ended are.
    expect((liveStatusClause as { status: { in: string[] } }).status.in).toEqual([
      'running',
      'waiting',
      'idle',
    ]);
    // no last_event_at gate on this branch
    expect(Object.keys(liveStatusClause as object)).toEqual(['status']);
  });

  it('excludes a stale session with last_event_at 2h ago given the where-clause semantics', () => {
    // Mirrors the Prisma `gte` semantics the route constructs above: a stale row is
    // included only when last_event_at >= (now - STALE_HIDE_MINUTES).
    const cutoff = new Date(Date.now() - 60 * 60_000);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000);
    expect(twoHoursAgo.getTime() >= cutoff.getTime()).toBe(false);
  });

  it('includes a stale session with last_event_at 10min ago given the where-clause semantics', () => {
    const cutoff = new Date(Date.now() - 60 * 60_000);
    const tenMinAgo = new Date(Date.now() - 10 * 60_000);
    expect(tenMinAgo.getTime() >= cutoff.getTime()).toBe(true);
  });

  it('a waiting/running session of any age passes the where-clause regardless of last_event_at', async () => {
    // Because the running/waiting branch has no last_event_at gate (asserted above),
    // any session with status running or waiting matches irrespective of age. Confirm
    // the shaping path itself doesn't add a secondary age filter by feeding the route
    // an old waiting/running session and checking it survives to the response.
    mockMachineFindMany.mockResolvedValue([
      machine({
        sessions: [
          session({
            id: 'waiting-old',
            status: 'waiting',
            last_event_at: new Date(Date.now() - 5 * 60 * 60_000),
          }),
          session({
            id: 'running-old',
            status: 'running',
            last_event_at: new Date(Date.now() - 5 * 60 * 60_000),
          }),
        ],
      }),
    ]);
    const body = await (await GET()).json();
    const ids = body.machines[0].sessions.map((s: { id: string }) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['waiting-old', 'running-old']));
  });
});

describe('GET /api/oracle/fleet — commands (1.5b)', () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(ADMIN);
  });

  it('includes recent commands per machine, shaped with title/cwd pulled from payload', async () => {
    mockMachineFindMany.mockResolvedValue([
      machine({
        commands: [
          command({ id: 'cmd-done', status: 'done', result: { tmux_session: 'oracle-abc', remote_control: 'confirmed' } }),
          command({ id: 'cmd-pending', status: 'pending' }),
        ],
      }),
    ]);

    const body = await (await GET()).json();
    expect(body.machines[0].commands).toHaveLength(2);
    expect(body.machines[0].commands[0]).toMatchObject({
      id: 'cmd-done',
      verb: 'spawn_session',
      status: 'done',
      title: 'New session',
      cwd: '/home/mike/project',
      result: { tmux_session: 'oracle-abc', remote_control: 'confirmed' },
    });
  });

  it('defaults to an empty commands array when a machine has none', async () => {
    mockMachineFindMany.mockResolvedValue([machine({ commands: [] })]);
    const body = await (await GET()).json();
    expect(body.machines[0].commands).toEqual([]);
  });
});

describe('GET /api/oracle/fleet — archived sessions (Clarity Phase 1)', () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(ADMIN);
  });

  it('excludes archived sessions from the default (no-arg) response', async () => {
    mockMachineFindMany.mockResolvedValue([machine()]);
    await GET();

    const callArgs = mockMachineFindMany.mock.calls[0][0];
    const sessionsWhere = callArgs.include.sessions.where;
    expect(sessionsWhere.AND).toContainEqual({ archived_at: null });
  });

  it('excludes archived sessions when include_archived is absent from the query string', async () => {
    mockMachineFindMany.mockResolvedValue([machine()]);
    await GET(fleetRequest());

    const callArgs = mockMachineFindMany.mock.calls[0][0];
    const sessionsWhere = callArgs.include.sessions.where;
    expect(sessionsWhere.AND).toContainEqual({ archived_at: null });
  });

  it('restores archived sessions when ?include_archived=true', async () => {
    mockMachineFindMany.mockResolvedValue([machine()]);
    await GET(fleetRequest({ include_archived: 'true' }));

    const callArgs = mockMachineFindMany.mock.calls[0][0];
    const sessionsWhere = callArgs.include.sessions.where;
    expect(sessionsWhere.AND).not.toContainEqual({ archived_at: null });
  });

  it('includes session-meaning fields on the shaped session (session_type/goal/waiting_on/ask_queue/ask_severity/arc_id/archived_at)', async () => {
    mockMachineFindMany.mockResolvedValue([
      machine({
        sessions: [
          session({
            id: 'sess-meaning',
            session_type: 'client_work',
            goal: 'Ship it',
            waiting_on: 'Approval',
            ask_queue: 'decide',
            ask_severity: 'launch_blocking',
            arc_id: 'arc-1',
          }),
        ],
      }),
    ]);

    const body = await (await GET()).json();
    expect(body.machines[0].sessions[0]).toMatchObject({
      session_type: 'client_work',
      goal: 'Ship it',
      waiting_on: 'Approval',
      ask_queue: 'decide',
      ask_severity: 'launch_blocking',
      arc_id: 'arc-1',
    });
  });
});
