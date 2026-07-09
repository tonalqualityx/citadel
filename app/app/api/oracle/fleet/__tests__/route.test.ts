import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
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

function machine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'machine-1',
    name: 'reshi-workstation',
    hostname: 'reshi.local',
    last_heartbeat_at: new Date(),
    sessions: [],
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

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(PM);
});

describe('GET /api/oracle/fleet — auth', () => {
  it('requires pm/admin role', async () => {
    mockMachineFindMany.mockResolvedValue([]);
    await GET();
    expect(mockRequireRole).toHaveBeenCalledWith(PM, ['pm', 'admin']);
  });
});

describe('GET /api/oracle/fleet — shape', () => {
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
