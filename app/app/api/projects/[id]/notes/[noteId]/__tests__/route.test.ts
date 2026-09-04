import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { DELETE } from '../route';

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
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/services/activity', () => ({
  logDelete: vi.fn(),
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { logDelete } from '@/lib/services/activity';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockProjectFindUnique = prisma.project.findUnique as Mock;
const mockProjectUpdate = prisma.project.update as Mock;
const mockNoteFindUnique = prisma.projectNote.findUnique as Mock;
const mockNoteUpdate = prisma.projectNote.update as Mock;
const mockLogDelete = logDelete as Mock;

const PROJECT_ID = 'project-1';
const NOTE_ID = 'note-1';
const UNTIL = new Date('2026-09-20T00:00:00.000Z');

function req(): NextRequest {
  return new NextRequest(`http://localhost:3000/api/projects/${PROJECT_ID}/notes/${NOTE_ID}`, {
    method: 'DELETE',
  });
}

function ctx() {
  return { params: Promise.resolve({ id: PROJECT_ID, noteId: NOTE_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-1', role: 'pm', email: 'pm@example.com' });
  mockRequireRole.mockImplementation(() => {});
});

describe('DELETE /api/projects/[id]/notes/[noteId]', () => {
  it('soft deletes a plain note without touching Project.stale_muted_until', async () => {
    mockNoteFindUnique.mockResolvedValue({
      id: NOTE_ID,
      project_id: PROJECT_ID,
      kind: 'note',
      until_date: null,
      is_deleted: false,
    });
    mockProjectFindUnique.mockResolvedValue({ id: PROJECT_ID, name: 'Test Project', stale_muted_until: null });

    const res = await DELETE(req(), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockNoteUpdate).toHaveBeenCalledWith({
      where: { id: NOTE_ID },
      data: { is_deleted: true },
    });
    expect(mockProjectUpdate).not.toHaveBeenCalled();
    expect(mockLogDelete).toHaveBeenCalledWith('user-1', 'project_note', NOTE_ID, 'Test Project');
  });

  it('deleting the ACTIVE parked_until note clears Project.stale_muted_until', async () => {
    mockNoteFindUnique.mockResolvedValue({
      id: NOTE_ID,
      project_id: PROJECT_ID,
      kind: 'parked_until',
      until_date: UNTIL,
      is_deleted: false,
    });
    mockProjectFindUnique.mockResolvedValue({ id: PROJECT_ID, name: 'Test Project', stale_muted_until: UNTIL });

    const res = await DELETE(req(), ctx());

    expect(res.status).toBe(200);
    expect(mockProjectUpdate).toHaveBeenCalledWith({
      where: { id: PROJECT_ID },
      data: { stale_muted_until: null },
    });
  });

  it('deleting a SUPERSEDED parked_until note does NOT clear the current mute', async () => {
    const olderUntil = new Date('2026-09-10T00:00:00.000Z');
    mockNoteFindUnique.mockResolvedValue({
      id: NOTE_ID,
      project_id: PROJECT_ID,
      kind: 'parked_until',
      until_date: olderUntil,
      is_deleted: false,
    });
    // A newer parked_until note already pushed stale_muted_until forward.
    mockProjectFindUnique.mockResolvedValue({ id: PROJECT_ID, name: 'Test Project', stale_muted_until: UNTIL });

    const res = await DELETE(req(), ctx());

    expect(res.status).toBe(200);
    expect(mockProjectUpdate).not.toHaveBeenCalled();
  });

  it('404s when the note does not exist', async () => {
    mockNoteFindUnique.mockResolvedValue(null);
    const res = await DELETE(req(), ctx());
    expect(res.status).toBe(404);
    expect(mockNoteUpdate).not.toHaveBeenCalled();
  });

  it('404s when the note belongs to a different project', async () => {
    mockNoteFindUnique.mockResolvedValue({
      id: NOTE_ID,
      project_id: 'some-other-project',
      kind: 'note',
      until_date: null,
      is_deleted: false,
    });
    const res = await DELETE(req(), ctx());
    expect(res.status).toBe(404);
  });

  it('404s when the note is already deleted', async () => {
    mockNoteFindUnique.mockResolvedValue({
      id: NOTE_ID,
      project_id: PROJECT_ID,
      kind: 'note',
      until_date: null,
      is_deleted: true,
    });
    const res = await DELETE(req(), ctx());
    expect(res.status).toBe(404);
  });

  it('requires PM/Admin role', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireRole.mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });

    const res = await DELETE(req(), ctx());
    expect(res.status).toBe(403);
  });
});
