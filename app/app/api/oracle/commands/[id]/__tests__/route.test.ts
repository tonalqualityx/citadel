import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { PATCH } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    oracleCommand: { findUnique: vi.fn(), updateMany: vi.fn() },
    oracleEvent: { create: vi.fn() },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockCommandFindUnique = prisma.oracleCommand.findUnique as Mock;
const mockCommandUpdateMany = prisma.oracleCommand.updateMany as Mock;
const mockEventCreate = prisma.oracleEvent.create as Mock;

const BOT = { userId: 'oracle-bot-1', role: 'pm', email: 'oracle@indelible.bot' };
const HUMAN = { userId: 'admin-1', role: 'admin', email: 'admin@indelible.agency' };

function patchRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/oracle/commands/cmd-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function params(id = 'cmd-1') {
  return { params: Promise.resolve({ id }) };
}

const PENDING_COMMAND = {
  id: 'cmd-1',
  machine_id: 'machine-1',
  verb: 'spawn_session',
  payload: { cwd: '/home/mike/project' },
  status: 'pending',
  claimed_at: null,
  completed_at: null,
  result: null,
  error: null,
  created_at: new Date(),
  updated_at: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockEventCreate.mockResolvedValue({});
});

describe('PATCH /api/oracle/commands/[id] — auth (bot only)', () => {
  it('rejects a human (even admin) caller with 403', async () => {
    mockRequireAuth.mockResolvedValue(HUMAN);
    const res = await PATCH(patchRequest({ action: 'claim' }), params());
    expect(res.status).toBe(403);
    expect(mockCommandFindUnique).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/oracle/commands/[id] — not found', () => {
  it('404s when the command does not exist', async () => {
    mockRequireAuth.mockResolvedValue(BOT);
    mockCommandFindUnique.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ action: 'claim' }), params('missing'));
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/oracle/commands/[id] — validation', () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(BOT);
    mockCommandFindUnique.mockResolvedValue(PENDING_COMMAND);
  });

  it('rejects an unrecognized action (400)', async () => {
    const res = await PATCH(patchRequest({ action: 'delete' }), params());
    expect(res.status).toBe(400);
  });

  it('rejects complete with an invalid status value (400)', async () => {
    const res = await PATCH(patchRequest({ action: 'complete', status: 'succeeded' }), params());
    expect(res.status).toBe(400);
  });

  it('rejects an oversized error string (400)', async () => {
    const res = await PATCH(
      patchRequest({ action: 'complete', status: 'failed', error: 'x'.repeat(2001) }),
      params()
    );
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/oracle/commands/[id] — atomic claim', () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(BOT);
    mockCommandFindUnique.mockResolvedValue(PENDING_COMMAND);
  });

  it('claims a pending command via an atomic updateMany gated on status=pending', async () => {
    mockCommandUpdateMany.mockResolvedValue({ count: 1 });
    mockCommandFindUnique.mockResolvedValueOnce(PENDING_COMMAND).mockResolvedValueOnce({
      ...PENDING_COMMAND,
      status: 'claimed',
      claimed_at: new Date(),
    });

    const res = await PATCH(patchRequest({ action: 'claim' }), params());
    expect(res.status).toBe(200);
    expect(mockCommandUpdateMany).toHaveBeenCalledWith({
      where: { id: 'cmd-1', status: 'pending' },
      data: expect.objectContaining({ status: 'claimed', claimed_at: expect.any(Date) }),
    });
    const body = await res.json();
    expect(body.status).toBe('claimed');
  });

  it('returns 409 when the atomic claim loses the race (count: 0 — already claimed)', async () => {
    mockCommandUpdateMany.mockResolvedValue({ count: 0 });

    const res = await PATCH(patchRequest({ action: 'claim' }), params());
    expect(res.status).toBe(409);
  });

  it('two sequential claim attempts on the same command yield exactly one success and one 409', async () => {
    // First call wins the atomic update (count: 1); second call's updateMany matches
    // nothing because the row is no longer status=pending (count: 0).
    mockCommandUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    mockCommandFindUnique
      .mockResolvedValueOnce(PENDING_COMMAND) // pre-check for attempt 1
      .mockResolvedValueOnce({ ...PENDING_COMMAND, status: 'claimed', claimed_at: new Date() }) // post-update fetch for attempt 1
      .mockResolvedValueOnce({ ...PENDING_COMMAND, status: 'claimed', claimed_at: new Date() }); // pre-check for attempt 2

    const first = await PATCH(patchRequest({ action: 'claim' }), params());
    const second = await PATCH(patchRequest({ action: 'claim' }), params());

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
  });
});

describe('PATCH /api/oracle/commands/[id] — complete transitions', () => {
  const CLAIMED_COMMAND = { ...PENDING_COMMAND, status: 'claimed', claimed_at: new Date() };

  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(BOT);
  });

  it('completes a claimed command as done, gated atomically on status=claimed, and writes a command_executed event', async () => {
    mockCommandFindUnique
      .mockResolvedValueOnce(CLAIMED_COMMAND)
      .mockResolvedValueOnce({
        ...CLAIMED_COMMAND,
        status: 'done',
        completed_at: new Date(),
        result: { tmux_session: 'oracle-abc12', remote_control: 'confirmed' },
      });
    mockCommandUpdateMany.mockResolvedValue({ count: 1 });

    const res = await PATCH(
      patchRequest({
        action: 'complete',
        status: 'done',
        result: { tmux_session: 'oracle-abc12', remote_control: 'confirmed' },
      }),
      params()
    );

    expect(res.status).toBe(200);
    expect(mockCommandUpdateMany).toHaveBeenCalledWith({
      where: { id: 'cmd-1', status: 'claimed' },
      data: expect.objectContaining({
        status: 'done',
        completed_at: expect.any(Date),
        result: { tmux_session: 'oracle-abc12', remote_control: 'confirmed' },
      }),
    });
    expect(mockEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        machine_id: CLAIMED_COMMAND.machine_id,
        kind: 'command_executed',
        payload: expect.objectContaining({
          command_id: 'cmd-1',
          verb: 'spawn_session',
          status: 'done',
        }),
      }),
    });
    const body = await res.json();
    expect(body.status).toBe('done');
  });

  it('completes a claimed command as failed with an error message', async () => {
    mockCommandFindUnique
      .mockResolvedValueOnce(CLAIMED_COMMAND)
      .mockResolvedValueOnce({ ...CLAIMED_COMMAND, status: 'failed', completed_at: new Date(), error: 'cwd outside $HOME' });
    mockCommandUpdateMany.mockResolvedValue({ count: 1 });

    const res = await PATCH(
      patchRequest({ action: 'complete', status: 'failed', error: 'cwd outside $HOME' }),
      params()
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('failed');
    expect(body.error).toBe('cwd outside $HOME');
  });

  it('rejects completing a command that is not currently claimed (409)', async () => {
    mockCommandFindUnique.mockResolvedValue(PENDING_COMMAND); // still pending, never claimed
    mockCommandUpdateMany.mockResolvedValue({ count: 0 });

    const res = await PATCH(patchRequest({ action: 'complete', status: 'done' }), params());
    expect(res.status).toBe(409);
    expect(mockEventCreate).not.toHaveBeenCalled();
  });
});
