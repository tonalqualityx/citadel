import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    status: 'running',
    needs_attention: false,
    attention_reason: null,
    started_at: new Date(),
    last_event_at: new Date(),
    ended_at: null,
    tokens_total: 100,
    agents: [],
    ...overrides,
  };
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
