import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { GET, POST } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    projectNote: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/services/activity', () => ({
  logCreate: vi.fn(),
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { logCreate } from '@/lib/services/activity';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockProjectFindUnique = prisma.project.findUnique as Mock;
const mockProjectUpdate = prisma.project.update as Mock;
const mockNoteFindMany = prisma.projectNote.findMany as Mock;
const mockNoteCreate = prisma.projectNote.create as Mock;
const mockLogCreate = logCreate as Mock;

const PROJECT_ID = 'project-1';

function note(overrides: Record<string, unknown> = {}) {
  return {
    id: 'note-1',
    project_id: PROJECT_ID,
    user_id: 'user-1',
    user: { id: 'user-1', name: 'Mike' },
    kind: 'note',
    body: 'Called the client.',
    until_date: null,
    is_deleted: false,
    created_at: new Date('2026-09-04T00:00:00Z'),
    updated_at: new Date('2026-09-04T00:00:00Z'),
    ...overrides,
  };
}

function getReq(): NextRequest {
  return new NextRequest(`http://localhost:3000/api/projects/${PROJECT_ID}/notes`);
}

function postReq(body: object): NextRequest {
  return new NextRequest(`http://localhost:3000/api/projects/${PROJECT_ID}/notes`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function ctx() {
  return { params: Promise.resolve({ id: PROJECT_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-1', role: 'pm', email: 'pm@example.com' });
  mockRequireRole.mockImplementation(() => {});
  mockProjectFindUnique.mockResolvedValue({ id: PROJECT_ID, name: 'Test Project' });
});

describe('GET /api/projects/[id]/notes', () => {
  it('lists non-deleted notes, newest first', async () => {
    mockNoteFindMany.mockResolvedValue([note(), note({ id: 'note-2' })]);

    const res = await GET(getReq(), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.count).toBe(2);
    expect(mockNoteFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { project_id: PROJECT_ID, is_deleted: false },
        orderBy: { created_at: 'desc' },
      })
    );
  });

  it('404s when the project does not exist', async () => {
    mockProjectFindUnique.mockResolvedValue(null);
    const res = await GET(getReq(), ctx());
    expect(res.status).toBe(404);
  });
});

describe('POST /api/projects/[id]/notes', () => {
  it('creates a plain note', async () => {
    mockNoteCreate.mockResolvedValue(note());

    const res = await POST(postReq({ body: 'Called the client.' }), ctx());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.kind).toBe('note');
    expect(mockNoteCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          project_id: PROJECT_ID,
          user_id: 'user-1',
          kind: 'note',
          body: 'Called the client.',
          until_date: null,
        }),
      })
    );
    // A plain note never touches Project.stale_muted_until.
    expect(mockProjectUpdate).not.toHaveBeenCalled();
    expect(mockLogCreate).toHaveBeenCalledWith('user-1', 'project_note', note().id, 'Test Project');
  });

  it('requires until_date when kind is parked_until', async () => {
    const res = await POST(postReq({ kind: 'parked_until', body: 'Snoozed' }), ctx());
    expect(res.status).toBe(400);
    expect(mockNoteCreate).not.toHaveBeenCalled();
  });

  it('creating a parked_until note also sets Project.stale_muted_until', async () => {
    const untilDate = '2026-09-20T00:00:00.000Z';
    mockNoteCreate.mockResolvedValue(note({ kind: 'parked_until', until_date: new Date(untilDate) }));

    const res = await POST(postReq({ kind: 'parked_until', body: 'Snoozed pending reply', until_date: untilDate }), ctx());

    expect(res.status).toBe(201);
    expect(mockProjectUpdate).toHaveBeenCalledWith({
      where: { id: PROJECT_ID },
      data: { stale_muted_until: new Date(untilDate) },
    });
  });

  it('rejects an empty body', async () => {
    const res = await POST(postReq({ body: '' }), ctx());
    expect(res.status).toBe(400);
    expect(mockNoteCreate).not.toHaveBeenCalled();
  });

  it('rejects a body over 10000 chars', async () => {
    const res = await POST(postReq({ body: 'a'.repeat(10001) }), ctx());
    expect(res.status).toBe(400);
    expect(mockNoteCreate).not.toHaveBeenCalled();
  });

  it('404s when the project does not exist', async () => {
    mockProjectFindUnique.mockResolvedValue(null);
    const res = await POST(postReq({ body: 'Note' }), ctx());
    expect(res.status).toBe(404);
  });

  it('requires PM/Admin role', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireRole.mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });

    const res = await POST(postReq({ body: 'Note' }), ctx());
    expect(res.status).toBe(403);
  });
});
