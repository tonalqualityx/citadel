import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { POST } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    oracleMachine: { upsert: vi.fn() },
    oracleSession: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    oracleAgent: { upsert: vi.fn() },
    oracleEvent: { create: vi.fn(), deleteMany: vi.fn() },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockMachineUpsert = prisma.oracleMachine.upsert as Mock;
const mockSessionFindUnique = prisma.oracleSession.findUnique as Mock;
const mockSessionCreate = prisma.oracleSession.create as Mock;
const mockSessionUpdate = prisma.oracleSession.update as Mock;
const mockSessionFindMany = prisma.oracleSession.findMany as Mock;
const mockSessionUpdateMany = prisma.oracleSession.updateMany as Mock;
const mockAgentUpsert = prisma.oracleAgent.upsert as Mock;
const mockEventCreate = prisma.oracleEvent.create as Mock;
const mockEventDeleteMany = prisma.oracleEvent.deleteMany as Mock;

const BOT = { userId: 'oracle-bot-1', role: 'pm', email: 'oracle@indelible.bot' };
const HUMAN = { userId: 'human-1', role: 'pm', email: 'mike@becomeindelible.com' };
const MACHINE = { id: 'machine-1', name: 'reshi-workstation', hostname: 'reshi.local' };

function ingestRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/oracle/ingest', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMachineUpsert.mockResolvedValue(MACHINE);
  mockSessionFindUnique.mockResolvedValue(null);
  mockSessionFindMany.mockResolvedValue([]);
  mockSessionUpdateMany.mockResolvedValue({ count: 0 });
  mockEventCreate.mockResolvedValue({});
  mockEventDeleteMany.mockResolvedValue({ count: 0 });
  mockAgentUpsert.mockResolvedValue({});
});

describe('POST /api/oracle/ingest — auth', () => {
  it('rejects a non-bot caller with 403 and never touches the DB', async () => {
    mockRequireAuth.mockResolvedValue(HUMAN);
    const res = await POST(ingestRequest({ machine: { name: 'reshi-workstation' } }));
    expect(res.status).toBe(403);
    expect(mockMachineUpsert).not.toHaveBeenCalled();
  });

  it('accepts the seeded oracle service bot', async () => {
    mockRequireAuth.mockResolvedValue(BOT);
    const res = await POST(ingestRequest({ machine: { name: 'reshi-workstation' } }));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/oracle/ingest — validation', () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(BOT);
  });

  it('rejects a payload missing machine.name (400, Zod)', async () => {
    const res = await POST(ingestRequest({ machine: {} }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('rejects an event with an invalid source enum', async () => {
    const res = await POST(
      ingestRequest({
        machine: { name: 'reshi-workstation' },
        events: [{ kind: 'Stop', external_id: 'sess-1', source: 'not-a-real-source', ts: new Date().toISOString() }],
      })
    );
    expect(res.status).toBe(400);
  });

  it('never crashes on an unrecognized event kind — accepted and stored', async () => {
    mockSessionCreate.mockResolvedValue({
      id: 'sess-new',
      source: 'claude_code',
      external_id: 'sess-1',
      status: 'running',
      last_event_at: new Date(),
      updated_at: new Date(),
    });
    const res = await POST(
      ingestRequest({
        machine: { name: 'reshi-workstation' },
        events: [
          {
            kind: 'SomeFutureHookEventWeDontKnowAboutYet',
            external_id: 'sess-1',
            source: 'claude_code',
            ts: new Date().toISOString(),
            payload: { anything: 'goes' },
          },
        ],
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events_ingested).toBe(1);
    expect(mockEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'SomeFutureHookEventWeDontKnowAboutYet' }) })
    );
  });
});

describe('POST /api/oracle/ingest — happy path events', () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(BOT);
  });

  it('creates a new session on first event and logs the event row', async () => {
    mockSessionCreate.mockResolvedValue({
      id: 'sess-new',
      source: 'claude_code',
      external_id: 'sess-1',
      status: 'running',
      last_event_at: new Date(),
      updated_at: new Date(),
    });

    const ts = new Date().toISOString();
    const res = await POST(
      ingestRequest({
        machine: { name: 'reshi-workstation', hostname: 'reshi.local' },
        sent_at: ts,
        events: [
          {
            kind: 'SessionStart',
            external_id: 'sess-1',
            source: 'claude_code',
            ts,
            title: 'My session',
            cwd: '/home/mike/project',
            model: 'claude-sonnet-5',
            payload: { cwd: '/home/mike/project' },
          },
        ],
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events_ingested).toBe(1);
    expect(mockSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          machine_id: MACHINE.id,
          source: 'claude_code',
          external_id: 'sess-1',
          status: 'running',
        }),
      })
    );
    expect(mockEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ session_id: 'sess-new', machine_id: MACHINE.id, kind: 'SessionStart' }),
      })
    );
  });

  it('flips an existing session to waiting on Stop and to running + clears attention on UserPromptSubmit', async () => {
    // last_event_at fixed a few seconds in the past so the event's ts is unambiguously
    // newer — with the resurrection guard's `ts <= last_event_at` stale check, two
    // back-to-back `new Date()` calls could otherwise tie in the same millisecond.
    const existing = {
      id: 'sess-existing',
      source: 'claude_code',
      external_id: 'sess-2',
      status: 'running',
      last_event_at: new Date(Date.now() - 5_000),
      updated_at: new Date(Date.now() - 5_000),
    };
    mockSessionFindUnique.mockResolvedValue(existing);
    mockSessionUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...existing,
      ...data,
    }));

    const ts = new Date().toISOString();
    await POST(
      ingestRequest({
        machine: { name: 'reshi-workstation' },
        events: [{ kind: 'Stop', external_id: 'sess-2', source: 'claude_code', ts }],
      })
    );

    expect(mockSessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'waiting' }) })
    );
  });

  it('sets needs_attention + attention_reason on a Notification event', async () => {
    const existing = {
      id: 'sess-existing',
      source: 'claude_code',
      external_id: 'sess-3',
      status: 'waiting',
      last_event_at: new Date(Date.now() - 5_000),
      updated_at: new Date(Date.now() - 5_000),
    };
    mockSessionFindUnique.mockResolvedValue(existing);
    mockSessionUpdate.mockResolvedValue({ ...existing, needs_attention: true });

    const ts = new Date().toISOString();
    await POST(
      ingestRequest({
        machine: { name: 'reshi-workstation' },
        events: [
          {
            kind: 'Notification',
            external_id: 'sess-3',
            source: 'claude_code',
            ts,
            payload: { message: 'Waiting on your approval' },
          },
        ],
      })
    );

    expect(mockSessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ needs_attention: true, attention_reason: 'Waiting on your approval' }),
      })
    );
  });

  it('rejects a batch over the 500-event cap (400, Zod)', async () => {
    const ts = new Date().toISOString();
    const events = Array.from({ length: 501 }, (_, i) => ({
      kind: 'Stop',
      external_id: `sess-${i}`,
      source: 'claude_code',
      ts,
    }));
    const res = await POST(ingestRequest({ machine: { name: 'reshi-workstation' }, events }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/oracle/ingest — snapshot + agents', () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(BOT);
  });

  it('upserts a snapshot session and its agents', async () => {
    mockSessionCreate.mockResolvedValue({
      id: 'wf-sess-1',
      source: 'workflow',
      external_id: 'wf-1',
      status: 'running',
      last_event_at: new Date(),
      updated_at: new Date(),
    });

    const res = await POST(
      ingestRequest({
        machine: { name: 'reshi-workstation' },
        snapshot: {
          sessions: [
            {
              external_id: 'wf-1',
              source: 'workflow',
              title: 'Fan-out run',
              status: 'running',
              agents: [
                { external_id: 'agent-1', label: 'Worker 1', status: 'done', tokens: 100 },
                { external_id: 'agent-2', label: 'Worker 2', status: 'running', tokens: 50 },
              ],
            },
          ],
        },
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions_upserted).toBe(1);
    expect(body.agents_upserted).toBe(2);
    expect(mockAgentUpsert).toHaveBeenCalledTimes(2);
  });

  it('reconciles a running session absent from the snapshot and stale for 5+ minutes to `stale`', async () => {
    const staleSince = new Date(Date.now() - 10 * 60_000); // 10 min ago > 5 min threshold
    mockSessionFindMany.mockResolvedValue([
      {
        id: 'ghost-session',
        source: 'claude_code',
        external_id: 'ghost-1',
        last_event_at: staleSince,
        updated_at: staleSince,
      },
    ]);
    mockSessionUpdateMany.mockResolvedValue({ count: 1 });

    const res = await POST(
      ingestRequest({
        machine: { name: 'reshi-workstation' },
        snapshot: { sessions: [] },
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reconciled_stale).toBe(1);
    expect(mockSessionUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['ghost-session'] } },
      data: { status: 'stale' },
    });
  });

  it('does NOT mark a session stale if it is present in the snapshot', async () => {
    const staleSince = new Date(Date.now() - 10 * 60_000);
    mockSessionFindMany.mockResolvedValue([
      {
        id: 'present-session',
        source: 'claude_code',
        external_id: 'present-1',
        last_event_at: staleSince,
        updated_at: staleSince,
      },
    ]);
    mockSessionFindUnique.mockResolvedValue({
      id: 'present-session',
      source: 'claude_code',
      external_id: 'present-1',
      status: 'running',
      last_event_at: staleSince,
      updated_at: staleSince,
    });
    mockSessionUpdate.mockResolvedValue({ id: 'present-session' });

    const res = await POST(
      ingestRequest({
        machine: { name: 'reshi-workstation' },
        snapshot: { sessions: [{ external_id: 'present-1', source: 'claude_code', status: 'running' }] },
      })
    );

    const body = await res.json();
    expect(body.reconciled_stale).toBe(0);
    expect(mockSessionUpdateMany).not.toHaveBeenCalled();
  });

  it('does NOT mark a running session stale if it was seen within the last 5 minutes', async () => {
    const recentlySeen = new Date(Date.now() - 60_000); // 1 min ago
    mockSessionFindMany.mockResolvedValue([
      {
        id: 'fresh-session',
        source: 'claude_code',
        external_id: 'fresh-1',
        last_event_at: recentlySeen,
        updated_at: recentlySeen,
      },
    ]);

    const res = await POST(
      ingestRequest({ machine: { name: 'reshi-workstation' }, snapshot: { sessions: [] } })
    );

    const body = await res.json();
    expect(body.reconciled_stale).toBe(0);
    expect(mockSessionUpdateMany).not.toHaveBeenCalled();
  });
});

describe('POST /api/oracle/ingest — pruning', () => {
  it('prunes events older than 7 days and still succeeds if pruning throws (snapshot-bearing call)', async () => {
    mockRequireAuth.mockResolvedValue(BOT);
    mockEventDeleteMany.mockRejectedValue(new Error('db hiccup'));

    const res = await POST(
      ingestRequest({ machine: { name: 'reshi-workstation' }, snapshot: { sessions: [] } })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pruned_events).toBe(0);
    expect(mockEventDeleteMany).toHaveBeenCalled();
  });

  it('does NOT run prune on a plain event POST with no snapshot (per-hook call)', async () => {
    mockRequireAuth.mockResolvedValue(BOT);
    mockSessionCreate.mockResolvedValue({
      id: 'sess-new',
      source: 'claude_code',
      external_id: 'sess-1',
      status: 'running',
      last_event_at: new Date(),
      updated_at: new Date(),
    });

    const res = await POST(
      ingestRequest({
        machine: { name: 'reshi-workstation' },
        events: [{ kind: 'SessionStart', external_id: 'sess-1', source: 'claude_code', ts: new Date().toISOString() }],
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pruned_events).toBe(0);
    expect(mockEventDeleteMany).not.toHaveBeenCalled();
  });
});

describe('POST /api/oracle/ingest — resurrection guard (review finding, 2026-07-09)', () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(BOT);
  });

  it('does not resurrect an ended session when a stale UserPromptSubmit arrives with an earlier ts', async () => {
    const sessionEndTs = new Date('2026-07-09T12:00:00.000Z');
    const staleUserPromptTs = new Date('2026-07-09T11:00:00.000Z'); // 1h EARLIER — spool replay

    // Session is already `ended`, with ended_at set, last_event_at at the SessionEnd time.
    const endedSession = {
      id: 'sess-ended-1',
      source: 'claude_code',
      external_id: 'sess-resurrect',
      status: 'ended',
      last_event_at: sessionEndTs,
      updated_at: sessionEndTs,
      ended_at: sessionEndTs,
      tokens_total: 100,
    };
    mockSessionFindUnique.mockResolvedValue(endedSession);
    mockSessionUpdate.mockResolvedValue(endedSession);

    await POST(
      ingestRequest({
        machine: { name: 'reshi-workstation' },
        events: [
          {
            kind: 'UserPromptSubmit',
            external_id: 'sess-resurrect',
            source: 'claude_code',
            ts: staleUserPromptTs.toISOString(),
          },
        ],
      })
    );

    expect(mockSessionUpdate).toHaveBeenCalledTimes(1);
    const callArgs = mockSessionUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    // No status flip back to running, ended_at untouched, last_event_at not moved backward.
    expect(callArgs.data.status).toBeUndefined();
    expect(callArgs.data.ended_at).toBeUndefined();
    expect(callArgs.data.needs_attention).toBeUndefined();
    expect(callArgs.data.last_event_at).toBeUndefined();
  });

  it('does not resurrect an ended session even when the late event carries a newer ts', async () => {
    const sessionEndTs = new Date('2026-07-09T12:00:00.000Z');
    const laterButStillPostEndTs = new Date('2026-07-09T12:30:00.000Z'); // newer ts, but session is terminal

    const endedSession = {
      id: 'sess-ended-2',
      source: 'claude_code',
      external_id: 'sess-resurrect-2',
      status: 'ended',
      last_event_at: sessionEndTs,
      updated_at: sessionEndTs,
      ended_at: sessionEndTs,
      tokens_total: 50,
    };
    mockSessionFindUnique.mockResolvedValue(endedSession);
    mockSessionUpdate.mockResolvedValue(endedSession);

    await POST(
      ingestRequest({
        machine: { name: 'reshi-workstation' },
        events: [
          {
            kind: 'UserPromptSubmit',
            external_id: 'sess-resurrect-2',
            source: 'claude_code',
            ts: laterButStillPostEndTs.toISOString(),
          },
        ],
      })
    );

    const callArgs = mockSessionUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(callArgs.data.status).toBeUndefined();
    expect(callArgs.data.ended_at).toBeUndefined();
    // last_event_at IS allowed to advance forward even on an ended session.
    expect(callArgs.data.last_event_at).toEqual(laterButStillPostEndTs);
  });

  it('still applies a normal transition on a genuinely newer event for an active (non-ended) session', async () => {
    const priorTs = new Date('2026-07-09T12:00:00.000Z');
    const newerTs = new Date('2026-07-09T12:05:00.000Z');
    const existing = {
      id: 'sess-active-1',
      source: 'claude_code',
      external_id: 'sess-active',
      status: 'running',
      last_event_at: priorTs,
      updated_at: priorTs,
      ended_at: null,
      tokens_total: 10,
    };
    mockSessionFindUnique.mockResolvedValue(existing);
    mockSessionUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...existing,
      ...data,
    }));

    await POST(
      ingestRequest({
        machine: { name: 'reshi-workstation' },
        events: [{ kind: 'Stop', external_id: 'sess-active', source: 'claude_code', ts: newerTs.toISOString() }],
      })
    );

    const callArgs = mockSessionUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(callArgs.data.status).toBe('waiting');
    expect(callArgs.data.last_event_at).toEqual(newerTs);
  });
});

describe('POST /api/oracle/ingest — token monotonicity (review finding, 2026-07-09)', () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(BOT);
  });

  it('never regresses claude_code tokens_total: a stale sample of 12 does not overwrite a stored 500000', async () => {
    const existing = {
      id: 'sess-tok-1',
      source: 'claude_code',
      external_id: 'sess-tok',
      status: 'running',
      last_event_at: new Date('2026-07-09T12:00:00.000Z'),
      updated_at: new Date('2026-07-09T12:00:00.000Z'),
      ended_at: null,
      tokens_total: 500_000,
    };
    mockSessionFindUnique.mockResolvedValue(existing);
    mockSessionUpdate.mockResolvedValue({ ...existing, tokens_total: 500_000 });

    await POST(
      ingestRequest({
        machine: { name: 'reshi-workstation' },
        snapshot: {
          sessions: [
            { external_id: 'sess-tok', source: 'claude_code', status: 'running', tokens_total: 12 },
          ],
        },
      })
    );

    const callArgs = mockSessionUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(callArgs.data.tokens_total).toBe(500_000);
  });

  it('advances claude_code tokens_total when the incoming sample is higher', async () => {
    const existing = {
      id: 'sess-tok-2',
      source: 'claude_code',
      external_id: 'sess-tok-2',
      status: 'running',
      last_event_at: new Date('2026-07-09T12:00:00.000Z'),
      updated_at: new Date('2026-07-09T12:00:00.000Z'),
      ended_at: null,
      tokens_total: 100,
    };
    mockSessionFindUnique.mockResolvedValue(existing);
    mockSessionUpdate.mockResolvedValue({ ...existing, tokens_total: 900 });

    await POST(
      ingestRequest({
        machine: { name: 'reshi-workstation' },
        events: [
          {
            kind: 'UserPromptSubmit',
            external_id: 'sess-tok-2',
            source: 'claude_code',
            ts: new Date('2026-07-09T12:05:00.000Z').toISOString(),
            tokens_total: 900,
          },
        ],
      })
    );

    const callArgs = mockSessionUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(callArgs.data.tokens_total).toBe(900);
  });

  it('keeps a plain authoritative overwrite for workflow sessions (wf.totalTokens is cumulative truth)', async () => {
    const existing = {
      id: 'sess-wf-1',
      source: 'workflow',
      external_id: 'wf-tok',
      status: 'running',
      last_event_at: new Date('2026-07-09T12:00:00.000Z'),
      updated_at: new Date('2026-07-09T12:00:00.000Z'),
      ended_at: null,
      tokens_total: 500_000,
    };
    mockSessionFindUnique.mockResolvedValue(existing);
    mockSessionUpdate.mockResolvedValue({ ...existing, tokens_total: 12 });

    await POST(
      ingestRequest({
        machine: { name: 'reshi-workstation' },
        snapshot: {
          sessions: [{ external_id: 'wf-tok', source: 'workflow', status: 'running', tokens_total: 12 }],
        },
      })
    );

    const callArgs = mockSessionUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(callArgs.data.tokens_total).toBe(12);
  });
});
