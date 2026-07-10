import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { AuthError } from '@/lib/api/errors';
import { POST, GET } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    oracleMachine: { findUnique: vi.fn() },
    oracleCommand: { create: vi.fn(), findMany: vi.fn() },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockMachineFindUnique = prisma.oracleMachine.findUnique as Mock;
const mockCommandCreate = prisma.oracleCommand.create as Mock;
const mockCommandFindMany = prisma.oracleCommand.findMany as Mock;

const ADMIN = { userId: 'admin-1', role: 'admin', email: 'admin@indelible.agency' };
const PM = { userId: 'pm-1', role: 'pm', email: 'pm@indelible.agency' };
const BOT = { userId: 'oracle-bot-1', role: 'pm', email: 'oracle@indelible.bot' };
const MACHINE = { id: 'machine-1', name: 'reshi-workstation' };

function postRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/oracle/commands', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function getRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/oracle/commands${query}`, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/oracle/commands — auth (admin only)', () => {
  it('rejects a pm caller with 403', async () => {
    mockRequireAuth.mockResolvedValue(PM);
    mockRequireRole.mockImplementationOnce(() => {
      throw new AuthError('Insufficient permissions', 403);
    });

    const res = await POST(postRequest({ machine: 'reshi-workstation', verb: 'spawn_session', payload: { cwd: '/home/mike/project' } }));
    expect(res.status).toBe(403);
    expect(mockCommandCreate).not.toHaveBeenCalled();
  });

  it('rejects the oracle service bot (role pm) with 403 — only admins may create commands', async () => {
    mockRequireAuth.mockResolvedValue(BOT);
    mockRequireRole.mockImplementationOnce(() => {
      throw new AuthError('Insufficient permissions', 403);
    });

    const res = await POST(postRequest({ machine: 'reshi-workstation', verb: 'spawn_session', payload: { cwd: '/home/mike/project' } }));
    expect(res.status).toBe(403);
  });

  it('allows an admin caller through', async () => {
    mockRequireAuth.mockResolvedValue(ADMIN);
    mockMachineFindUnique.mockResolvedValue(MACHINE);
    mockCommandCreate.mockResolvedValue({
      id: 'cmd-1',
      verb: 'spawn_session',
      payload: { cwd: '/home/mike/project' },
      status: 'pending',
      created_by_id: ADMIN.userId,
      claimed_at: null,
      completed_at: null,
      result: null,
      error: null,
      created_at: new Date(),
    });

    const res = await POST(postRequest({ machine: 'reshi-workstation', verb: 'spawn_session', payload: { cwd: '/home/mike/project' } }));
    expect(res.status).toBe(201);
  });
});

describe('POST /api/oracle/commands — validation', () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(ADMIN);
  });

  it('rejects an unknown verb (400, Zod literal)', async () => {
    const res = await POST(
      postRequest({ machine: 'reshi-workstation', verb: 'run_shell', payload: { cwd: '/home/mike/project' } })
    );
    expect(res.status).toBe(400);
    expect(mockCommandCreate).not.toHaveBeenCalled();
  });

  it('rejects an oversized prompt (>10240 chars, 400)', async () => {
    const res = await POST(
      postRequest({
        machine: 'reshi-workstation',
        verb: 'spawn_session',
        payload: { cwd: '/home/mike/project', prompt: 'x'.repeat(10241) },
      })
    );
    expect(res.status).toBe(400);
  });

  it('rejects a prompt beginning with "-" (CLI flag injection guard, e.g. --dangerously-skip-permissions)', async () => {
    const res = await POST(
      postRequest({
        machine: 'reshi-workstation',
        verb: 'spawn_session',
        payload: { cwd: '/home/mike/project', prompt: '--dangerously-skip-permissions' },
      })
    );
    expect(res.status).toBe(400);
    expect(mockCommandCreate).not.toHaveBeenCalled();
  });

  it('rejects a prompt beginning with "-" (CLI flag injection guard, e.g. --mcp-config RCE payload)', async () => {
    const res = await POST(
      postRequest({
        machine: 'reshi-workstation',
        verb: 'spawn_session',
        payload: {
          cwd: '/home/mike/project',
          prompt: '--mcp-config={"mcpServers":{"pwn":{"command":"touch","args":["/tmp/pwned"]}}}',
        },
      })
    );
    expect(res.status).toBe(400);
    expect(mockCommandCreate).not.toHaveBeenCalled();
  });

  it('rejects a prompt beginning with whitespace then "-" (guard is not fooled by leading spaces)', async () => {
    const res = await POST(
      postRequest({
        machine: 'reshi-workstation',
        verb: 'spawn_session',
        payload: { cwd: '/home/mike/project', prompt: '   --dangerously-skip-permissions' },
      })
    );
    expect(res.status).toBe(400);
  });

  it('allows a benign prompt that merely contains a dash mid-string', async () => {
    mockMachineFindUnique.mockResolvedValue(MACHINE);
    mockCommandCreate.mockResolvedValue({
      id: 'cmd-ok',
      verb: 'spawn_session',
      payload: { cwd: '/home/mike/project', prompt: 'fix the login-page bug' },
      status: 'pending',
      created_by_id: ADMIN.userId,
      claimed_at: null,
      completed_at: null,
      result: null,
      error: null,
      created_at: new Date(),
    });
    const res = await POST(
      postRequest({
        machine: 'reshi-workstation',
        verb: 'spawn_session',
        payload: { cwd: '/home/mike/project', prompt: 'fix the login-page bug' },
      })
    );
    expect(res.status).toBe(201);
  });

  it('rejects a missing cwd (400)', async () => {
    const res = await POST(
      postRequest({ machine: 'reshi-workstation', verb: 'spawn_session', payload: {} })
    );
    expect(res.status).toBe(400);
  });

  it('rejects a payload missing machine (400)', async () => {
    const res = await POST(postRequest({ verb: 'spawn_session', payload: { cwd: '/home/mike/project' } }));
    expect(res.status).toBe(400);
  });

  it('404s when the named machine does not exist', async () => {
    mockMachineFindUnique.mockResolvedValue(null);
    const res = await POST(
      postRequest({ machine: 'ghost-machine', verb: 'spawn_session', payload: { cwd: '/home/mike/project' } })
    );
    expect(res.status).toBe(404);
    expect(mockCommandCreate).not.toHaveBeenCalled();
  });
});

describe('POST /api/oracle/commands — happy path', () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(ADMIN);
    mockMachineFindUnique.mockResolvedValue(MACHINE);
  });

  it('creates a pending command scoped to the machine, created_by the calling admin', async () => {
    const created = {
      id: 'cmd-1',
      verb: 'spawn_session',
      payload: { cwd: '/home/mike/project', title: 'New session', prompt: 'do the thing' },
      status: 'pending',
      created_by_id: ADMIN.userId,
      claimed_at: null,
      completed_at: null,
      result: null,
      error: null,
      created_at: new Date(),
    };
    mockCommandCreate.mockResolvedValue(created);

    const res = await POST(
      postRequest({
        machine: 'reshi-workstation',
        verb: 'spawn_session',
        payload: { cwd: '/home/mike/project', title: 'New session', prompt: 'do the thing' },
      })
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      id: 'cmd-1',
      machine: 'reshi-workstation',
      verb: 'spawn_session',
      status: 'pending',
      created_by_id: ADMIN.userId,
    });

    expect(mockCommandCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        machine_id: MACHINE.id,
        verb: 'spawn_session',
        status: 'pending',
        created_by_id: ADMIN.userId,
      }),
    });
  });
});

describe('GET /api/oracle/commands — auth (bot only)', () => {
  it('rejects a human caller with 403', async () => {
    mockRequireAuth.mockResolvedValue(ADMIN);
    const res = await GET(getRequest('?machine=reshi-workstation'));
    expect(res.status).toBe(403);
    expect(mockCommandFindMany).not.toHaveBeenCalled();
  });

  it('accepts the seeded oracle service bot', async () => {
    mockRequireAuth.mockResolvedValue(BOT);
    mockCommandFindMany.mockResolvedValue([]);
    const res = await GET(getRequest('?machine=reshi-workstation'));
    expect(res.status).toBe(200);
  });
});

describe('GET /api/oracle/commands — validation + scoping', () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(BOT);
  });

  it('requires the machine query param (400)', async () => {
    const res = await GET(getRequest(''));
    expect(res.status).toBe(400);
    expect(mockCommandFindMany).not.toHaveBeenCalled();
  });

  it('rejects an invalid status value (400)', async () => {
    const res = await GET(getRequest('?machine=reshi-workstation&status=bogus'));
    expect(res.status).toBe(400);
  });

  it('defaults to status=pending and returns commands for the named machine only, oldest first', async () => {
    mockCommandFindMany.mockResolvedValue([
      { id: 'cmd-1', verb: 'spawn_session', payload: { cwd: '/a' }, status: 'pending', created_at: new Date(), claimed_at: null, completed_at: null, result: null, error: null },
    ]);

    const res = await GET(getRequest('?machine=reshi-workstation'));
    expect(res.status).toBe(200);
    expect(mockCommandFindMany).toHaveBeenCalledWith({
      where: { status: 'pending', machine: { name: 'reshi-workstation' } },
      orderBy: { created_at: 'asc' },
    });
    const body = await res.json();
    expect(body.commands).toHaveLength(1);
    expect(body.commands[0]).toMatchObject({ id: 'cmd-1', verb: 'spawn_session', status: 'pending' });
  });

  it('honors an explicit status filter', async () => {
    mockCommandFindMany.mockResolvedValue([]);
    await GET(getRequest('?machine=reshi-workstation&status=claimed'));
    expect(mockCommandFindMany).toHaveBeenCalledWith({
      where: { status: 'claimed', machine: { name: 'reshi-workstation' } },
      orderBy: { created_at: 'asc' },
    });
  });

  it('returns an empty list for a machine with no matching commands (e.g. never ingested)', async () => {
    mockCommandFindMany.mockResolvedValue([]);
    const body = await (await GET(getRequest('?machine=unknown-machine'))).json();
    expect(body.commands).toEqual([]);
  });
});
